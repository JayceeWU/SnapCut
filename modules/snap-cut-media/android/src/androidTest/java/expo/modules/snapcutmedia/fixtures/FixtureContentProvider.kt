package expo.modules.snapcutmedia.fixtures

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/** Test-only provider for opaque metadata, seekable files, and non-seekable pipes. */
class FixtureContentProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun getType(uri: Uri): String? {
    if (uri.getQueryParameter("mime") == "null") return null
    return when (fixtureKind(uri)) {
      FixtureKind.WAV -> "audio/wav"
      // Intentionally wrong: runtime tests prove extractor content is authoritative.
      FixtureKind.MP3_RENAMED_M4S -> "video/iso.segment"
      FixtureKind.FRAGMENT -> "video/iso.segment"
      FixtureKind.BYTES -> "application/octet-stream"
    }
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?
  ): Cursor {
    denyIfRequested(uri, "query")
    val payload = payload(uri)
    val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
    return MatrixCursor(columns).apply {
      addRow(
        columns.map { column ->
          when (column) {
            OpenableColumns.DISPLAY_NAME -> displayName(uri)
            OpenableColumns.SIZE -> reportedSize(uri, "cursorSize", payload.size.toLong())
            else -> null
          }
        }.toTypedArray()
      )
    }
  }

  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor {
    requireReadMode(mode)
    denyIfRequested(uri, "asset")
    val payload = payload(uri)
    val descriptor = openDescriptor(uri, payload)
    val declaredLength = reportedSize(uri, "assetSize", payload.size.toLong())
      ?: AssetFileDescriptor.UNKNOWN_LENGTH
    return AssetFileDescriptor(descriptor, 0L, declaredLength)
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    requireReadMode(mode)
    denyIfRequested(uri, "file")
    return openDescriptor(uri, payload(uri))
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri = unsupported()

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
    unsupported()

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?
  ): Int = unsupported()

  private fun openDescriptor(uri: Uri, payload: ByteArray): ParcelFileDescriptor =
    when (uri.getQueryParameter("transport")) {
      "pipe", "slow" -> pipe(payload, uri.getQueryParameter("delayMs")?.toLongOrNull() ?: 0L)
      else -> ParcelFileDescriptor.open(
        cachedFixture(fixtureKind(uri), payload),
        ParcelFileDescriptor.MODE_READ_ONLY
      )
    }

  private fun pipe(payload: ByteArray, requestedDelayMs: Long): ParcelFileDescriptor {
    val (readSide, writeSide) = ParcelFileDescriptor.createPipe()
    val delayMs = requestedDelayMs.coerceIn(0L, MAX_PIPE_DELAY_MS)
    Thread(
      {
        try {
          ParcelFileDescriptor.AutoCloseOutputStream(writeSide).use { output ->
            var offset = 0
            while (offset < payload.size) {
              val count = minOf(PIPE_CHUNK_BYTES, payload.size - offset)
              output.write(payload, offset, count)
              output.flush()
              offset += count
              if (delayMs > 0L && offset < payload.size) Thread.sleep(delayMs)
            }
          }
        } catch (_: IOException) {
          // Expected when the consumer cancels or closes a metadata descriptor without reading.
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
        }
      },
      "snapcut-fixture-pipe"
    ).apply {
      isDaemon = true
      start()
    }
    return readSide
  }

  private fun cachedFixture(kind: FixtureKind, payload: ByteArray): File {
    val root = File(requireNotNull(context).cacheDir, "snapcut-provider-fixtures")
    check(root.exists() || root.mkdirs())
    val file = File(root, "${kind.name.lowercase()}-${payload.size}.bin")
    synchronized(FILE_LOCK) {
      if (!file.isFile || file.length() != payload.size.toLong()) {
        FileOutputStream(file, false).use { it.write(payload) }
      }
    }
    return file
  }

  private fun payload(uri: Uri): ByteArray = when (fixtureKind(uri)) {
    FixtureKind.WAV -> RuntimeMediaFixtures.pcmWav
    FixtureKind.MP3_RENAMED_M4S -> RuntimeMediaFixtures.legalMp3(requireNotNull(context).cacheDir)
    FixtureKind.FRAGMENT -> RuntimeMediaFixtures.fragmentWithoutInitialization
    FixtureKind.BYTES -> RuntimeMediaFixtures.patternBytes(
      uri.getQueryParameter("length")?.toIntOrNull() ?: DEFAULT_PATTERN_BYTES
    )
  }

  private fun fixtureKind(uri: Uri): FixtureKind = when (uri.pathSegments.firstOrNull()) {
    "wav" -> FixtureKind.WAV
    "mp3-renamed-m4s" -> FixtureKind.MP3_RENAMED_M4S
    "fragment" -> FixtureKind.FRAGMENT
    "bytes" -> FixtureKind.BYTES
    else -> throw IllegalArgumentException("Unknown test fixture")
  }

  private fun displayName(uri: Uri): String? {
    if (uri.getQueryParameter("name") == "null") return null
    return when (fixtureKind(uri)) {
      FixtureKind.WAV -> "tone.wav"
      FixtureKind.MP3_RENAMED_M4S -> "provider-renamed-audio.m4s"
      FixtureKind.FRAGMENT -> "missing-init.m4s"
      FixtureKind.BYTES -> "opaque.bin"
    }
  }

  private fun reportedSize(uri: Uri, key: String, actual: Long): Long? =
    when (val value = uri.getQueryParameter(key) ?: "actual") {
      "null" -> null
      "zero" -> 0L
      "minus-one" -> -1L
      "actual" -> actual
      "actual-minus-one" -> actual - 1L
      "actual-plus-one" -> actual + 1L
      else -> value.toLongOrNull() ?: throw IllegalArgumentException("Invalid fixture size")
    }

  private fun denyIfRequested(uri: Uri, stage: String) {
    val deniedStage = uri.getQueryParameter("deny")
    if (deniedStage == "all" || deniedStage == stage) {
      // Never include the URI: capability/query tokens must not enter errors or logs.
      throw SecurityException("Fixture permission revoked")
    }
  }

  private fun requireReadMode(mode: String) {
    if (!mode.startsWith("r")) throw SecurityException("Fixture is read-only")
  }

  private fun <T> unsupported(): T = throw UnsupportedOperationException("Fixture is read-only")

  private enum class FixtureKind { WAV, MP3_RENAMED_M4S, FRAGMENT, BYTES }

  private companion object {
    val FILE_LOCK = Any()
    const val DEFAULT_PATTERN_BYTES = 4 * 1024
    const val PIPE_CHUNK_BYTES = 8 * 1024
    const val MAX_PIPE_DELAY_MS = 500L
  }
}
