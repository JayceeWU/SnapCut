package expo.modules.snapcutmedia.source

import android.content.ContentResolver
import android.content.Context
import android.media.MediaExtractor
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.os.StatFs
import android.provider.OpenableColumns
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.jobs.NativeJobResource
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.FilterInputStream
import java.io.FilterOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal interface MediaResourceHooks {
  fun attach(resource: NativeJobResource)
  fun detach(resource: NativeJobResource)

  companion object {
    val NONE = object : MediaResourceHooks {
      override fun attach(resource: NativeJobResource) = Unit
      override fun detach(resource: NativeJobResource) = Unit
    }
  }
}

internal class ManagedExtractor(
  val extractor: MediaExtractor,
  hooks: MediaResourceHooks,
  cancelPendingOpen: () -> Unit
) : Closeable, NativeJobResource {
  private val resource = ProvisionalExtractorResource(
    hooks,
    extractor::release,
    cancelPendingOpen
  )

  fun ownDescriptor(descriptor: ParcelFileDescriptor) = resource.ownDescriptor(descriptor)

  override fun close() = cancel()

  override fun cancel() = resource.cancel()
}

/** Attached before provider/extractor setup so cancellation can close every acquired handle. */
internal class ProvisionalExtractorResource(
  private val hooks: MediaResourceHooks,
  private val releaseExtractor: () -> Unit,
  private val cancelPendingOpen: () -> Unit = {}
) : Closeable, NativeJobResource {
  private val closed = AtomicBoolean(false)
  private val descriptor = AtomicReference<Closeable?>(null)

  init {
    try {
      hooks.attach(this)
    } catch (error: Exception) {
      if (closed.compareAndSet(false, true)) runCatching(releaseExtractor)
      throw error
    }
  }

  fun ownDescriptor(value: Closeable) {
    if (!descriptor.compareAndSet(null, value)) {
      runCatching(value::close)
      throw IllegalStateException("Extractor descriptor ownership is already assigned")
    }
    if (closed.get()) {
      if (descriptor.compareAndSet(value, null)) runCatching(value::close)
      throw IllegalStateException("Extractor resource was cancelled during setup")
    }
  }

  override fun close() = cancel()

  override fun cancel() {
    if (!closed.compareAndSet(false, true)) return
    runCatching { hooks.detach(this) }
    runCatching(cancelPendingOpen)
    runCatching { descriptor.getAndSet(null)?.close() }
    runCatching(releaseExtractor)
  }
}

/**
 * Provider streams are job resources, not just lexical resources. Closing the
 * stream from cancelImport/cancelWaveform is what unblocks a provider that is
 * stalled inside read().
 */
internal class ManagedInputStream(
  private val delegate: InputStream,
  private val hooks: MediaResourceHooks
) : FilterInputStream(delegate), NativeJobResource {
  private val closed = AtomicBoolean(false)

  init {
    hooks.attach(this)
  }

  override fun close() = cancel()

  override fun cancel() {
    if (!closed.compareAndSet(false, true)) return
    hooks.detach(this)
    runCatching(delegate::close)
  }
}

private class ManagedOutputStream(
  private val delegate: OutputStream,
  private val hooks: MediaResourceHooks
) : FilterOutputStream(delegate), NativeJobResource {
  private val closed = AtomicBoolean(false)

  init {
    hooks.attach(this)
  }

  override fun close() = cancel()

  override fun cancel() {
    if (!closed.compareAndSet(false, true)) return
    hooks.detach(this)
    runCatching(delegate::close)
  }
}

internal class SourceSession private constructor(
  val sourceUri: Uri,
  val actualSizeBytes: Long?,
  val requiresStreamingSizeVerification: Boolean,
  val containerProbe: ContainerProbe,
  private val resolver: ContentResolver,
  private val context: Context?,
  private val spoolFile: File?,
  private val hooks: MediaResourceHooks,
  private val cancellation: CancellationCheck
) : Closeable {
  private val closed = AtomicBoolean(false)

  fun openInputStream(): InputStream {
    check(!closed.get()) { "SourceSession is closed" }
    val input = spoolFile?.let(::FileInputStream)
      ?: resolver.openInputStream(sourceUri)
      ?: throw mediaError(SnapCutMediaError.SOURCE_UNREADABLE)
    return ManagedInputStream(input, hooks)
  }

  fun openExtractor(): ManagedExtractor {
    check(!closed.get()) { "SourceSession is closed" }
    if (spoolFile == null && context != null) {
      val directExtractor = MediaExtractor()
      val directCancellation = CancellationSignal()
      val direct = try {
        ManagedExtractor(directExtractor, hooks, directCancellation::cancel)
      } catch (error: Exception) {
        cancellation.throwIfCancelled()
        throw mapOpenError(error)
      }
      try {
        directExtractor.setDataSource(context, sourceUri, null)
        return direct
      } catch (error: SecurityException) {
        direct.close()
        cancellation.throwIfCancelled()
        throw mapOpenError(error)
      } catch (_: Exception) {
        // Some API 29 DocumentsProviders cannot satisfy the Context/Uri path
        // even though their descriptor is readable. Retry once through the
        // owned PFD path without copying the provider source.
        direct.close()
        cancellation.throwIfCancelled()
      }
    }
    val extractor = MediaExtractor()
    val openCancellation = CancellationSignal()
    val managed = try {
      ManagedExtractor(extractor, hooks, openCancellation::cancel)
    } catch (error: Exception) {
      cancellation.throwIfCancelled()
      throw mapOpenError(error)
    }
    try {
      if (spoolFile != null) {
        extractor.setDataSource(spoolFile.absolutePath)
      } else {
        val descriptor = resolver.openFileDescriptor(sourceUri, "r", openCancellation)
          ?: throw mediaError(SnapCutMediaError.SOURCE_UNREADABLE)
        managed.ownDescriptor(descriptor)
        extractor.setDataSource(descriptor.fileDescriptor)
      }
      return managed
    } catch (error: Exception) {
      managed.close()
      cancellation.throwIfCancelled()
      throw mapOpenError(error)
    }
  }

  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    if (spoolFile != null) runCatching(spoolFile::delete)
  }

  companion object {
    private const val WORKING_MARGIN_BYTES = 16L * 1024L * 1024L

    fun open(
      resolver: ContentResolver,
      sourceUriString: String,
      maxSourceBytes: Long,
      spoolRoot: File,
      cancellation: CancellationCheck = CancellationCheck.NONE,
      hooks: MediaResourceHooks = MediaResourceHooks.NONE,
      onStage: (SourceInspectionStage) -> Unit = {},
      context: Context? = null
    ): SourceSession {
      val uri = parseSourceUri(sourceUriString)
      val limit = SourceSizePolicy.effectiveLimit(maxSourceBytes)
      try {
        onStage(SourceInspectionStage.SIZE_PROBE)
        val reported = collectReportedSizes(resolver, uri)
        // A contradictory provider report is advisory. The bounded stream is
        // authoritative even when one of the three reported values is above
        // the limit. Matching, known values can still fail fast.
        if (!reported.requiresStreamingVerification) {
          SourceSizePolicy.requireReportedSizeWithinLimit(reported.reportedSizeBytes, limit)
        }
        val seekable = isSeekable(resolver, uri)
        var spool: File? = null
        val actualSize = when {
          !seekable -> {
            onStage(SourceInspectionStage.STREAM_VERIFICATION)
            val expectedSpoolBytes = if (reported.requiresStreamingVerification) {
              limit
            } else {
              reported.reportedSizeBytes ?: limit
            }
            ensureSpoolCapacity(spoolRoot, expectedSpoolBytes)
            spool = createSpoolFile(spoolRoot)
            try {
              openManagedInputStream(resolver, uri, hooks).use { input ->
                ManagedOutputStream(FileOutputStream(spool), hooks).use { output ->
                  BoundedSourceIo.copy(input, output, limit, cancellation).bytesCopied
                }
              }
            } catch (error: Exception) {
              runCatching(spool::delete)
              throw error
            }
          }
          reported.requiresStreamingVerification -> {
            onStage(SourceInspectionStage.STREAM_VERIFICATION)
            openManagedInputStream(resolver, uri, hooks).use { input ->
              BoundedSourceIo.copy(input, null, limit, cancellation).bytesCopied
            }
          }
          else -> reported.reportedSizeBytes
        }
        if (actualSize != null && actualSize <= 0L) {
          runCatching { spool?.delete() }
          throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
        }
        onStage(SourceInspectionStage.CONTAINER_PROBE)
        val probe = (spool?.let { ManagedInputStream(FileInputStream(it), hooks) }
          ?: openManagedInputStream(resolver, uri, hooks)).use { input ->
          ContainerProbe.read(input)
        }
        return SourceSession(
          sourceUri = uri,
          actualSizeBytes = actualSize,
          requiresStreamingSizeVerification = reported.requiresStreamingVerification,
          containerProbe = probe,
          resolver = resolver,
          context = context,
          spoolFile = spool,
          hooks = hooks,
          cancellation = cancellation
        )
      } catch (error: Exception) {
        cancellation.throwIfCancelled()
        throw mapOpenError(error)
      }
    }

    private fun openManagedInputStream(
      resolver: ContentResolver,
      uri: Uri,
      hooks: MediaResourceHooks
    ): ManagedInputStream {
      val input = resolver.openInputStream(uri)
        ?: throw mediaError(SnapCutMediaError.SOURCE_UNREADABLE)
      return ManagedInputStream(input, hooks)
    }

    private fun parseSourceUri(value: String): Uri {
      if (value.isBlank() || value.any(Char::isISOControl)) {
        throw mediaError(SnapCutMediaError.INVALID_REQUEST)
      }
      val uri = Uri.parse(value)
      if (uri.scheme != ContentResolver.SCHEME_CONTENT && uri.scheme != ContentResolver.SCHEME_FILE) {
        throw mediaError(SnapCutMediaError.UNSUPPORTED_MEDIA)
      }
      return uri
    }

    private fun collectReportedSizes(
      resolver: ContentResolver,
      uri: Uri
    ): SourceSizePolicy.Resolution {
      var cursorSize: Long? = null
      runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val column = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (column >= 0 && !cursor.isNull(column)) cursorSize = cursor.getLong(column)
          }
        }
      }.onFailure { if (it is SecurityException) throw it }
      val assetLength = runCatching {
        resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
      }.getOrElse { error ->
        if (error is SecurityException) throw error
        null
      }
      val statSize = runCatching {
        resolver.openFileDescriptor(uri, "r")?.use { it.statSize }
      }.getOrElse { error ->
        if (error is SecurityException) throw error
        null
      }
      return SourceSizePolicy.resolveReportedSizes(cursorSize, assetLength, statSize)
    }

    private fun isSeekable(resolver: ContentResolver, uri: Uri): Boolean = try {
      resolver.openFileDescriptor(uri, "r")?.use { descriptor ->
        val position = Os.lseek(descriptor.fileDescriptor, 0L, OsConstants.SEEK_CUR)
        Os.lseek(descriptor.fileDescriptor, position, OsConstants.SEEK_SET)
        true
      } ?: false
    } catch (_: ErrnoException) {
      false
    } catch (error: SecurityException) {
      throw error
    } catch (_: Exception) {
      false
    }

    private fun ensureSpoolCapacity(root: File, expectedBytes: Long) {
      if (!root.exists() && !root.mkdirs()) {
        throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
      }
      val required = try {
        Math.addExact(expectedBytes, WORKING_MARGIN_BYTES)
      } catch (_: ArithmeticException) {
        Long.MAX_VALUE
      }
      if (StatFs(root.absolutePath).availableBytes < required) {
        throw mediaError(SnapCutMediaError.DISK_SPACE_LOW)
      }
    }

    private fun createSpoolFile(root: File): File {
      val canonicalRoot = try {
        root.canonicalFile
      } catch (error: IOException) {
        throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED, cause = error)
      }
      val file = File(canonicalRoot, ".source-${UUID.randomUUID()}.spool")
      if (!file.createNewFile()) throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
      return file
    }

    private fun mapOpenError(error: Exception): Exception = when (error) {
      is SnapCutMediaException -> error
      // Provider exception messages frequently embed the complete content URI
      // (including query capabilities), so do not retain them as causes.
      is SecurityException -> mediaError(SnapCutMediaError.SOURCE_PERMISSION_DENIED)
      is FileNotFoundException -> mediaError(SnapCutMediaError.SOURCE_NOT_FOUND)
      else -> mediaError(SnapCutMediaError.SOURCE_UNREADABLE)
    }
  }
}
