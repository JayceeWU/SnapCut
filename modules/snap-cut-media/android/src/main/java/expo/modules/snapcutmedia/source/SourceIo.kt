package expo.modules.snapcutmedia.source

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import java.io.InputStream
import java.io.OutputStream

internal fun interface CancellationCheck {
  fun throwIfCancelled()

  companion object {
    val NONE = CancellationCheck { }
  }
}

internal object BoundedSourceIo {
  data class CopyResult(val bytesCopied: Long)

  fun copy(
    input: InputStream,
    output: OutputStream?,
    maxBytes: Long,
    cancellation: CancellationCheck = CancellationCheck.NONE,
    onProgress: (Long) -> Unit = {}
  ): CopyResult {
    val limit = SourceSizePolicy.effectiveLimit(maxBytes)
    val buffer = ByteArray(SourceSizePolicy.STREAM_BUFFER_BYTES)
    var total = 0L
    while (true) {
      cancellation.throwIfCancelled()
      val remainingWithSentinel = limit + 1L - total
      if (remainingWithSentinel <= 0L) {
        throw mediaError(SnapCutMediaError.SOURCE_TOO_LARGE)
      }
      val requested = minOf(buffer.size.toLong(), remainingWithSentinel).toInt()
      val read = input.read(buffer, 0, requested)
      if (read < 0) break
      if (read == 0) continue
      total += read
      if (total > limit) {
        throw mediaError(SnapCutMediaError.SOURCE_TOO_LARGE)
      }
      output?.write(buffer, 0, read)
      onProgress(total)
    }
    SourceSizePolicy.requireStreamedSizeWithinLimit(total, maxBytes)
    return CopyResult(total)
  }
}

internal data class ContainerProbe(
  val isIsoBmff: Boolean,
  val hasMovieBox: Boolean,
  val hasMovieFragmentBox: Boolean,
  val isWave: Boolean,
  val isFlac: Boolean = false
) {
  val isFragmentedMp4: Boolean get() = isIsoBmff && hasMovieFragmentBox
  val isFragmentMissingInitialization: Boolean
    get() = isFragmentedMp4 && !hasMovieBox

  companion object {
    const val MAX_PROBE_BYTES = 4 * 1024 * 1024

    fun read(input: InputStream): ContainerProbe {
      val bytes = ByteArray(MAX_PROBE_BYTES)
      var used = 0
      while (used < bytes.size) {
        val read = input.read(bytes, used, bytes.size - used)
        if (read <= 0) break
        used += read
      }
      return fromBytes(bytes.copyOf(used))
    }

    fun fromBytes(bytes: ByteArray): ContainerProbe {
      val isWave = bytes.size >= 12 &&
        ascii(bytes, 0, 4) == "RIFF" &&
        ascii(bytes, 8, 4) == "WAVE"
      val isFlac = bytes.size >= 4 && ascii(bytes, 0, 4) == "fLaC"
      var offset = 0L
      var sawIsoBox = false
      var sawMoov = false
      var sawMoof = false
      while (offset + 8L <= bytes.size.toLong()) {
        val start = offset.toInt()
        var boxSize = unsignedInt(bytes, start)
        val type = ascii(bytes, start + 4, 4)
        var headerSize = 8L
        if (boxSize == 1L) {
          if (offset + 16L > bytes.size) break
          boxSize = unsignedLong(bytes, start + 8) ?: break
          headerSize = 16L
        } else if (boxSize == 0L) {
          boxSize = bytes.size.toLong() - offset
        }
        if (boxSize < headerSize) break
        if (type == "ftyp" || type == "moov" || type == "moof" || type == "mdat") {
          sawIsoBox = true
        }
        if (type == "moov") sawMoov = true
        if (type == "moof") sawMoof = true
        val next = offset + boxSize
        if (next <= offset || next > bytes.size.toLong()) break
        offset = next
      }
      return ContainerProbe(sawIsoBox, sawMoov, sawMoof, isWave, isFlac)
    }

    private fun ascii(bytes: ByteArray, offset: Int, length: Int): String {
      if (offset < 0 || length < 0 || offset + length > bytes.size) return ""
      return bytes.copyOfRange(offset, offset + length).toString(Charsets.US_ASCII)
    }

    private fun unsignedInt(bytes: ByteArray, offset: Int): Long {
      if (offset < 0 || offset + 4 > bytes.size) return -1L
      return ((bytes[offset].toLong() and 0xffL) shl 24) or
        ((bytes[offset + 1].toLong() and 0xffL) shl 16) or
        ((bytes[offset + 2].toLong() and 0xffL) shl 8) or
        (bytes[offset + 3].toLong() and 0xffL)
    }

    private fun unsignedLong(bytes: ByteArray, offset: Int): Long? {
      if (offset < 0 || offset + 8 > bytes.size || bytes[offset] < 0) return null
      var result = 0L
      for (index in 0 until 8) {
        result = (result shl 8) or (bytes[offset + index].toLong() and 0xffL)
      }
      return result
    }
  }
}
