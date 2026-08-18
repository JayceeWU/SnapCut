package expo.modules.snapcutmedia.exportmedia

import android.content.ContentResolver
import android.content.ContentValues
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal data class PublishedMedia(
  val contentUri: String,
  val displayName: String,
  val fileSizeBytes: Long
)

/**
 * Linearizes the final MediaStore update with export cancellation.
 *
 * Everything passed to [commit] must already have been validated. Once the action starts,
 * cancellation is no longer allowed to turn a successfully published file into a failed export.
 */
internal fun interface MediaStoreCommitBoundary {
  fun commit(action: () -> Boolean): Boolean

  companion object {
    val DIRECT = MediaStoreCommitBoundary { action -> action() }
  }
}

internal interface MediaStoreGateway {
  fun existingDisplayNames(): Set<String>
  fun insertPending(displayName: String, mimeType: String): String
  fun openOutput(contentUri: String): OutputStream
  fun publish(contentUri: String): Boolean
  fun readDisplayName(contentUri: String): String?
  fun readSize(contentUri: String): Long?
  fun delete(contentUri: String)
}

internal class AndroidMediaStoreGateway(
  private val resolver: ContentResolver
) : MediaStoreGateway {
  private val collection: Uri = MediaStore.Audio.Media.getContentUri(
    MediaStore.VOLUME_EXTERNAL_PRIMARY
  )

  override fun existingDisplayNames(): Set<String> {
    return runCatching {
      val names = linkedSetOf<String>()
      resolver.query(
        collection,
        arrayOf(MediaStore.Audio.Media.DISPLAY_NAME),
        "${MediaStore.Audio.Media.RELATIVE_PATH}=?",
        arrayOf(RELATIVE_PATH_WITH_SEPARATOR),
        null
      )?.use { cursor ->
        val column = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME)
        while (column >= 0 && cursor.moveToNext()) {
          if (!cursor.isNull(column)) cursor.getString(column)?.let(names::add)
        }
      }
      names
    }.getOrDefault(emptySet())
  }

  override fun insertPending(displayName: String, mimeType: String): String {
    val values = ContentValues().apply {
      put(MediaStore.Audio.Media.DISPLAY_NAME, displayName)
      put(MediaStore.Audio.Media.MIME_TYPE, mimeType)
      put(MediaStore.Audio.Media.RELATIVE_PATH, RELATIVE_PATH)
      put(MediaStore.Audio.Media.IS_PENDING, 1)
    }
    return resolver.insert(collection, values)?.toString()
      ?: throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)
  }

  override fun openOutput(contentUri: String): OutputStream =
    resolver.openOutputStream(Uri.parse(contentUri), "w")
      ?: throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)

  override fun publish(contentUri: String): Boolean {
    val values = ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }
    val uri = Uri.parse(contentUri)
    if (resolver.update(uri, values, null, null) > 0) return true

    // A few Android 10 providers report an update count of zero even though the row was
    // published. Confirm the state instead of deleting a successfully committed export.
    return runCatching {
      resolver.query(
        uri,
        arrayOf(MediaStore.Audio.Media.IS_PENDING),
        null,
        null,
        null
      )?.use { cursor ->
        val column = cursor.getColumnIndex(MediaStore.Audio.Media.IS_PENDING)
        column >= 0 && cursor.moveToFirst() && cursor.getInt(column) == 0
      } == true
    }.getOrDefault(false)
  }

  override fun readDisplayName(contentUri: String): String? {
    return runCatching {
      var displayName: String? = null
      resolver.query(
        Uri.parse(contentUri),
        arrayOf(MediaStore.Audio.Media.DISPLAY_NAME),
        null,
        null,
        null
      )?.use { cursor ->
        val column = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME)
        if (column >= 0 && cursor.moveToFirst() && !cursor.isNull(column)) {
          displayName = cursor.getString(column)
        }
      }
      displayName
    }.getOrNull()
  }

  override fun readSize(contentUri: String): Long? {
    val uri = Uri.parse(contentUri)

    // MediaStore.SIZE may lag behind the bytes on Android 10, especially on vendor providers.
    // Prefer the actual file descriptor, then count the row's bytes while it is still pending.
    val descriptorSize = runCatching {
      resolver.openFileDescriptor(uri, "r")?.use { descriptor -> descriptor.statSize }
    }.getOrNull()?.takeIf { it > 0L }
    if (descriptorSize != null) return descriptorSize

    val streamedSize = runCatching {
      resolver.openInputStream(uri)?.use { input ->
        val buffer = ByteArray(SIZE_BUFFER_BYTES)
        var total = 0L
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          if (read == 0) continue
          total = Math.addExact(total, read.toLong())
        }
        total
      }
    }.getOrNull()?.takeIf { it > 0L }
    if (streamedSize != null) return streamedSize

    var size: Long? = null
    runCatching {
      resolver.query(
        uri,
        arrayOf(MediaStore.Audio.Media.SIZE),
        null,
        null,
        null
      )?.use { cursor ->
        val column = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE)
        if (column >= 0 && cursor.moveToFirst() && !cursor.isNull(column)) {
          size = cursor.getLong(column).takeIf { it > 0L }
        }
      }
    }
    return size
  }

  override fun delete(contentUri: String) {
    resolver.delete(Uri.parse(contentUri), null, null)
  }

  private companion object {
    const val SIZE_BUFFER_BYTES = 64 * 1024
    val RELATIVE_PATH: String = Environment.DIRECTORY_MUSIC + "/SnapCut"
    val RELATIVE_PATH_WITH_SEPARATOR: String = "$RELATIVE_PATH/"
  }
}

internal class MediaStorePublisher(
  private val gateway: MediaStoreGateway
) {
  fun publish(
    stagingFile: File,
    displayNameWithoutExtension: String,
    format: ExportFormat,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE,
    onProgress: (Double) -> Unit = {},
    beforePublish: () -> Unit = {},
    commitBoundary: MediaStoreCommitBoundary = MediaStoreCommitBoundary.DIRECT
  ): PublishedMedia {
    if (!stagingFile.isFile || stagingFile.length() <= 0L) {
      throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)
    }
    ExportNaming.requireValidBaseName(displayNameWithoutExtension)
    val specification = ExportNaming.specification(format)
    val existingNames = try {
      gateway.existingDisplayNames()
    } catch (error: Exception) {
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED, cause = error)
    }
    val requestedDisplayName = chooseDisplayName(
      displayNameWithoutExtension,
      specification.extension,
      existingNames
    )
    cancellation.throwIfCancelled()
    val contentUri = try {
      gateway.insertPending(requestedDisplayName, specification.mimeType)
    } catch (error: Exception) {
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED, cause = error)
    }
    val parsedContentUri = runCatching { java.net.URI(contentUri) }.getOrNull()
    if (
      parsedContentUri?.scheme != "content" ||
      parsedContentUri?.rawAuthority.isNullOrBlank()
    ) {
      runCatching { gateway.delete(contentUri) }
      throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)
    }
    val pending = try {
      PendingMediaStoreRow(contentUri, gateway, hooks)
    } catch (error: Exception) {
      runCatching { gateway.delete(contentUri) }
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED, cause = error)
    }
    val expectedSize = stagingFile.length()
    try {
      ManagedMediaStoreInput(FileInputStream(stagingFile), hooks).use { input ->
        gateway.openOutput(contentUri).use { rawOutput ->
          ManagedMediaStoreOutput(rawOutput, pending).use { output ->
            val buffer = ByteArray(COPY_BUFFER_BYTES)
            val total = expectedSize
            var copied = 0L
            while (true) {
              cancellation.throwIfCancelled()
              val read = input.read(buffer)
              if (read < 0) break
              if (read == 0) continue
              output.write(buffer, 0, read)
              copied = Math.addExact(copied, read.toLong())
              onProgress((copied.toDouble() / total.toDouble()).coerceIn(0.0, 1.0))
            }
            output.flush()
            if (copied != total) throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)
          }
        }
      }
      cancellation.throwIfCancelled()
      beforePublish()
      cancellation.throwIfCancelled()

      // The output stream is closed above. Verify the still-pending row before making it public.
      if (gateway.readSize(contentUri) != expectedSize) {
        throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)
      }
      val actualDisplayName = gateway.readDisplayName(contentUri)?.takeIf(String::isNotBlank)
        ?: requestedDisplayName
      cancellation.throwIfCancelled()

      val published = commitBoundary.commit {
        if (!pending.beginPublishing()) {
          throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
        }
        if (!gateway.publish(contentUri)) {
          false
        } else {
          pending.markPublished()
          true
        }
      }
      if (!published) {
        throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)
      }
      // IS_PENDING=0 is the irreversible success point. Do not consult cancellation afterwards.
      return PublishedMedia(contentUri, actualDisplayName, expectedSize)
    } catch (error: Exception) {
      pending.abort()
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED, cause = error)
    }
  }

  internal fun chooseDisplayName(
    baseName: String,
    extension: String,
    existingNames: Set<String>
  ): String {
    val folded = existingNames.mapTo(hashSetOf()) { it.lowercase() }
    var suffix = 1
    while (true) {
      val candidate = if (suffix == 1) {
        "$baseName$extension"
      } else {
        "$baseName ($suffix)$extension"
      }
      if (candidate.lowercase() !in folded) return candidate
      suffix++
      if (suffix > MAX_NAME_ATTEMPTS) {
        throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)
      }
    }
  }

  private companion object {
    const val COPY_BUFFER_BYTES = 64 * 1024
    const val MAX_NAME_ATTEMPTS = 10_000
  }
}

internal object ExportNaming {
  data class Specification(val extension: String, val mimeType: String)

  fun requireValidBaseName(value: String) {
    val codePoints = value.codePointCount(0, value.length)
    if (
      value.isBlank() ||
      value != value.trim() ||
      codePoints !in 1..100 ||
      value.any(Char::isISOControl) ||
      value.any { it in FORBIDDEN_FILE_NAME_CHARACTERS } ||
      value == "." ||
      value == ".." ||
      value.endsWith(".m4a", true) ||
      value.endsWith(".flac", true) ||
      value.endsWith(".mp3", true)
    ) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
  }

  fun specification(format: ExportFormat): Specification = when (format) {
    ExportFormat.M4A -> Specification(".m4a", "audio/mp4")
    ExportFormat.MP3 -> Specification(".mp3", "audio/mpeg")
  }

  private const val FORBIDDEN_FILE_NAME_CHARACTERS = "/\\:*?\"<>|"
}

private class PendingMediaStoreRow(
  private val contentUri: String,
  private val gateway: MediaStoreGateway,
  private val hooks: MediaResourceHooks
) : NativeJobResource {
  private enum class State {
    PENDING,
    PUBLISHING,
    PUBLISHED,
    CANCELLED
  }

  private val state = AtomicReference(State.PENDING)
  private val activeOutput = AtomicReference<OutputStream?>(null)

  init {
    try {
      hooks.attach(this)
    } catch (error: Exception) {
      state.set(State.CANCELLED)
      runCatching { hooks.detach(this) }
      throw error
    }
  }

  fun beginPublishing(): Boolean = state.compareAndSet(State.PENDING, State.PUBLISHING)

  fun markPublished() {
    // beginPublishing() owns this state until MediaStore publication either succeeds or aborts.
    check(state.compareAndSet(State.PUBLISHING, State.PUBLISHED))
    runCatching { hooks.detach(this) }
  }

  fun attachOutput(output: OutputStream) {
    if (state.get() != State.PENDING || !activeOutput.compareAndSet(null, output)) {
      runCatching(output::close)
      throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
    }
  }

  fun detachOutput(output: OutputStream) {
    activeOutput.compareAndSet(output, null)
  }

  override fun cancel() {
    // Once publication starts, the publishing owner exclusively decides success or rollback.
    if (!state.compareAndSet(State.PENDING, State.CANCELLED)) return
    cleanupPendingRow()
  }

  fun abort() {
    while (true) {
      when (val current = state.get()) {
        State.PUBLISHED,
        State.CANCELLED -> return
        State.PENDING,
        State.PUBLISHING -> if (state.compareAndSet(current, State.CANCELLED)) {
          cleanupPendingRow()
          return
        }
      }
    }
  }

  private fun cleanupPendingRow() {
    runCatching { hooks.detach(this) }
    runCatching { activeOutput.getAndSet(null)?.close() }
    runCatching { gateway.delete(contentUri) }
  }
}

private class ManagedMediaStoreOutput(
  private val output: OutputStream,
  private val pending: PendingMediaStoreRow
) : Closeable {
  private val closed = AtomicBoolean(false)

  init {
    pending.attachOutput(output)
  }

  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    pending.detachOutput(output)
    runCatching(output::close)
  }

  fun write(buffer: ByteArray, offset: Int, length: Int) = output.write(buffer, offset, length)
  fun flush() = output.flush()
}

private class ManagedMediaStoreInput(
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
