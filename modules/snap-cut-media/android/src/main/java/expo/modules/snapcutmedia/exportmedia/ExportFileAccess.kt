package expo.modules.snapcutmedia.exportmedia

import android.media.MediaExtractor
import android.media.MediaMuxer
import android.os.StatFs
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.models.NativePreviewClip
import expo.modules.snapcutmedia.models.TrackId
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.storage.PrivateOutputUri
import expo.modules.snapcutmedia.timeline.TimelineAudio
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

internal data class ResolvedExportClip(
  val clipId: String,
  val sourceId: String,
  val file: File,
  val startMs: Long,
  val endMs: Long,
  val trackId: TrackId,
  val timelineStartMs: Long,
  val gain: Double,
  val fadeInMs: Long,
  val fadeOutMs: Long
) {
  val durationMs: Long get() = endMs - startMs
  val timelineEndMs: Long get() = Math.addExact(timelineStartMs, durationMs)
}

internal object ExportFileAccess {
  private val SAFE_JOB_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")

  fun resolveClips(
    clips: List<NativePreviewClip>,
    projectRoots: Collection<File>
  ): List<ResolvedExportClip> {
    val orderedClips = TimelineAudio.validate(clips)
    val clipIds = hashSetOf<String>()
    val sourceFiles = hashMapOf<String, String>()
    return orderedClips.map { clip ->
      if (
        clip.clipId.isBlank() ||
        clip.sourceId.isBlank() ||
        !clipIds.add(clip.clipId) ||
        clip.startMs < 0L ||
        clip.endMs <= clip.startMs
      ) {
        throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
      }
      val file = PrivateOutputUri.requireSafeFileUri(clip.audioFileUri, projectRoots)
      if (!file.isFile || file.length() <= 0L) {
        throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE)
      }
      val previous = sourceFiles.putIfAbsent(clip.sourceId, file.path)
      if (previous != null && previous != file.path) {
        throw mediaError(SnapCutMediaError.INVALID_REQUEST)
      }
      ResolvedExportClip(
        clip.clipId,
        clip.sourceId,
        file,
        clip.startMs,
        clip.endMs,
        clip.trackId,
        clip.timelineStartMs,
        clip.gain,
        clip.fadeInMs,
        clip.fadeOutMs
      )
    }
  }

  fun createJobDirectory(stagingRoot: File, jobId: String): File {
    if (!SAFE_JOB_ID.matches(jobId)) throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    if (!stagingRoot.exists() && !stagingRoot.mkdirs()) {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
    }
    val canonicalRoot = runCatching(stagingRoot::getCanonicalFile).getOrElse {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED, cause = it)
    }
    val directory = runCatching {
      File(canonicalRoot, ".export-$jobId").canonicalFile
    }.getOrElse {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED, cause = it)
    }
    if (
      directory.parentFile?.path != canonicalRoot.path ||
      (directory.exists() && !directory.deleteRecursively()) ||
      !directory.mkdirs()
    ) {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
    }
    return directory
  }

  /**
   * Keeps the URI spelling rooted at the same app-private path supplied by Android while
   * proving that its canonical parent is the job directory we just created. This avoids
   * false PATH_OUTSIDE_PRIVATE_STORAGE failures on devices where an app-private path has
   * more than one system spelling (for example /data/user/0 and /data/data).
   */
  fun createJobOutputFile(stagingRoot: File, jobDirectory: File, fileName: String): File {
    if (
      fileName.isBlank() ||
      fileName != File(fileName).name ||
      fileName.any(Char::isISOControl)
    ) {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
    }
    val output = File(File(stagingRoot.absoluteFile, jobDirectory.name), fileName)
    val outputParent = runCatching { output.parentFile?.canonicalFile }.getOrNull()
    val expectedParent = runCatching(jobDirectory::getCanonicalFile).getOrNull()
    if (outputParent == null || expectedParent == null || outputParent.path != expectedParent.path) {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
    }
    return output
  }

  fun sha256(
    file: File,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): String {
    val digest = MessageDigest.getInstance("SHA-256")
    ManagedExportInput(FileInputStream(file), hooks).use { input ->
      val buffer = ByteArray(HASH_BUFFER_BYTES)
      while (true) {
        cancellation.throwIfCancelled()
        val read = input.read(buffer)
        if (read < 0) break
        if (read > 0) digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  fun requireFreeSpace(path: File, requiredBytes: Long) {
    var existingPath: File? = path.absoluteFile
    while (existingPath != null && !existingPath.exists()) existingPath = existingPath.parentFile
    val probe = existingPath ?: throw mediaError(SnapCutMediaError.DISK_SPACE_LOW)
    val availableBytes = runCatching { StatFs(probe.absolutePath).availableBytes }.getOrElse {
      throw mediaError(SnapCutMediaError.DISK_SPACE_LOW, cause = it)
    }
    if (requiredBytes <= 0L || availableBytes < requiredBytes) {
      throw mediaError(SnapCutMediaError.DISK_SPACE_LOW)
    }
  }

  private const val HASH_BUFFER_BYTES = 64 * 1024
}

internal class ExportExtractorResource(
  val extractor: MediaExtractor,
  private val hooks: MediaResourceHooks
) : Closeable, NativeJobResource {
  private val closed = AtomicBoolean(false)

  init {
    try {
      hooks.attach(this)
    } catch (error: Exception) {
      closed.set(true)
      runCatching(extractor::release)
      throw error
    }
  }

  override fun close() = cancel()

  override fun cancel() {
    if (!closed.compareAndSet(false, true)) return
    runCatching { hooks.detach(this) }
    runCatching(extractor::release)
  }
}

internal class ExportMuxerResource(
  val muxer: MediaMuxer,
  private val hooks: MediaResourceHooks
) : Closeable, NativeJobResource {
  private val closed = AtomicBoolean(false)
  private val started = AtomicBoolean(false)

  init {
    try {
      hooks.attach(this)
    } catch (error: Exception) {
      closed.set(true)
      runCatching(muxer::release)
      throw error
    }
  }

  fun markStarted() {
    started.set(true)
  }

  fun markStopped() {
    started.set(false)
  }

  override fun close() = cancel()

  override fun cancel() {
    if (!closed.compareAndSet(false, true)) return
    runCatching { hooks.detach(this) }
    if (started.getAndSet(false)) runCatching(muxer::stop)
    runCatching(muxer::release)
  }
}

private class ManagedExportInput(
  private val input: FileInputStream,
  private val hooks: MediaResourceHooks
) : java.io.FilterInputStream(input), NativeJobResource {
  private val closed = AtomicBoolean(false)

  init {
    try {
      hooks.attach(this)
    } catch (error: Exception) {
      closed.set(true)
      runCatching(input::close)
      throw error
    }
  }

  override fun close() = cancel()

  override fun cancel() {
    if (!closed.compareAndSet(false, true)) return
    runCatching { hooks.detach(this) }
    runCatching(input::close)
  }
}
