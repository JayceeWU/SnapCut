package expo.modules.snapcutmedia.export

import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

internal data class FrameSlice(val firstFrame: Int, val endFrameExclusive: Int) {
  val frameCount: Int get() = endFrameExclusive - firstFrame

  init {
    require(firstFrame >= 0 && endFrameExclusive >= firstFrame)
  }
}
/** Exact [start, end) selection using ceil(deltaUs * rate / 1_000_000). */
internal object ClipFrameMath {
  fun slice(
    bufferPresentationTimeUs: Long,
    bufferFrameCount: Int,
    sampleRateHz: Int,
    clipStartMs: Long,
    clipEndMs: Long
  ): FrameSlice {
    require(bufferPresentationTimeUs >= 0L && bufferFrameCount >= 0 && sampleRateHz > 0)
    require(clipStartMs >= 0L && clipEndMs > clipStartMs)
    val startUs = Math.multiplyExact(clipStartMs, 1_000L)
    val endUs = Math.multiplyExact(clipEndMs, 1_000L)
    val first = offset(startUs - bufferPresentationTimeUs, sampleRateHz)
      .coerceIn(0L, bufferFrameCount.toLong()).toInt()
    val end = offset(endUs - bufferPresentationTimeUs, sampleRateHz)
      .coerceIn(0L, bufferFrameCount.toLong()).toInt()
    return FrameSlice(first, maxOf(first, end))
  }

  fun durationFrames(durationMs: Long, sampleRateHz: Int): Long {
    require(durationMs > 0L && sampleRateHz > 0)
    return ceilProduct(durationMs, sampleRateHz.toLong(), 1_000L)
  }

  private fun offset(deltaUs: Long, rate: Int): Long = if (deltaUs <= 0L) {
    0L
  } else {
    ceilProduct(deltaUs, rate.toLong(), 1_000_000L)
  }

  private fun ceilProduct(left: Long, right: Long, divisor: Long): Long = try {
    Math.addExact(Math.multiplyExact(left, right), divisor - 1L) / divisor
  } catch (_: ArithmeticException) {
    BigInteger.valueOf(left).multiply(BigInteger.valueOf(right))
      .add(BigInteger.valueOf(divisor - 1L))
      .divide(BigInteger.valueOf(divisor))
      .longValueExact()
  }
}

internal enum class PcmSampleEncoding(val bytesPerSample: Int) {
  UNSIGNED_8(1), SIGNED_16(2), SIGNED_24_PACKED(3), SIGNED_32(4), FLOAT_32(4)
}

internal object DecodedPcm {
  fun readInterleaved(
    source: ByteBuffer,
    channelCount: Int,
    encoding: PcmSampleEncoding
  ): FloatArray {
    require(channelCount in 1..2)
    val frameBytes = encoding.bytesPerSample * channelCount
    require(source.remaining() % frameBytes == 0) { "PCM buffer contains a partial frame" }
    val pcm = source.slice().order(ByteOrder.LITTLE_ENDIAN)
    return FloatArray(pcm.remaining() / encoding.bytesPerSample) { readSample(pcm, encoding) }
  }

  fun sliceFrames(data: FloatArray, channels: Int, slice: FrameSlice): FloatArray {
    require(channels in 1..2 && data.size % channels == 0)
    require(slice.endFrameExclusive <= data.size / channels)
    return data.copyOfRange(slice.firstFrame * channels, slice.endFrameExclusive * channels)
  }

  fun convertChannels(data: FloatArray, inputChannels: Int, outputChannels: Int): FloatArray {
    require(inputChannels in 1..2 && outputChannels in 1..2 && data.size % inputChannels == 0)
    if (inputChannels == outputChannels) return FloatArray(data.size) { sanitize(data[it]) }
    require(inputChannels == 1 && outputChannels == 2) {
      "Stereo-to-mono conversion is outside SnapCut v1's channel policy"
    }
    return FloatArray(data.size * 2).also { stereo ->
      data.forEachIndexed { frame, raw ->
        val sample = sanitize(raw)
        stereo[frame * 2] = sample
        stereo[frame * 2 + 1] = sample
      }
    }
  }

  fun quantizeSigned24(data: FloatArray): IntArray = IntArray(data.size) { index ->
    val sample = sanitize(data[index])
    when {
      sample <= -1f -> -8_388_608
      sample >= 1f -> 8_388_607
      else -> (sample * 8_388_608f).roundToInt().coerceIn(-8_388_608, 8_388_607)
    }
  }

  fun sanitize(sample: Float): Float = if (sample.isFinite()) sample.coerceIn(-1f, 1f) else 0f

  private fun readSample(buffer: ByteBuffer, encoding: PcmSampleEncoding): Float {
    val value = when (encoding) {
      PcmSampleEncoding.UNSIGNED_8 -> ((buffer.get().toInt() and 0xff) - 128) / 128f
      PcmSampleEncoding.SIGNED_16 -> buffer.short / 32768f
      PcmSampleEncoding.SIGNED_24_PACKED -> {
        var sample = (buffer.get().toInt() and 0xff) or
          ((buffer.get().toInt() and 0xff) shl 8) or
          ((buffer.get().toInt() and 0xff) shl 16)
        if ((sample and 0x800000) != 0) sample = sample or -0x1000000
        sample / 8_388_608f
      }
      PcmSampleEncoding.SIGNED_32 -> buffer.int / 2_147_483_648f
      PcmSampleEncoding.FLOAT_32 -> buffer.float
    }
    return sanitize(value)
  }
}
