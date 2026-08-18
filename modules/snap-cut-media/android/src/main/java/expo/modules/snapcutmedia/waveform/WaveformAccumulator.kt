package expo.modules.snapcutmedia.waveform

import android.media.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

internal data class WaveformData(
  val durationMs: Long,
  val binCount: Int,
  val rms: DoubleArray,
  val peak: DoubleArray
) {
  fun requireValid(): WaveformData {
    require(durationMs > 0L)
    require(binCount > 0 && rms.size == binCount && peak.size == binCount)
    require(rms.all { it.isFinite() && it in 0.0..1.0 })
    require(peak.all { it.isFinite() && it in 0.0..1.0 })
    return this
  }
}

internal class WaveformAccumulator(
  private val durationMs: Long,
  private val sampleRateHz: Int,
  private val binCount: Int
) {
  private val sumSquares = DoubleArray(binCount)
  private val peaks = DoubleArray(binCount)
  private val sampleCounts = LongArray(binCount)
  private val expectedFrames = max(1L, durationMs * sampleRateHz.toLong() / 1000L)
  private var framesSeen = 0L

  init {
    require(durationMs > 0L && sampleRateHz > 0 && binCount > 0)
  }

  fun addFrame(channelSamples: DoubleArray) {
    if (channelSamples.isEmpty()) return
    val bin = minOf(binCount - 1, ((framesSeen * binCount) / expectedFrames).toInt())
    channelSamples.forEach { raw ->
      val sample = raw.takeIf(Double::isFinite)?.coerceIn(-1.0, 1.0) ?: 0.0
      sumSquares[bin] += sample * sample
      peaks[bin] = max(peaks[bin], abs(sample))
      sampleCounts[bin]++
    }
    framesSeen++
  }

  fun fraction(): Double = (framesSeen.toDouble() / expectedFrames.toDouble()).coerceIn(0.0, 1.0)

  fun hasFrames(): Boolean = framesSeen > 0L

  fun finish(): WaveformData {
    val rawRms = DoubleArray(binCount) { index ->
      val count = sampleCounts[index]
      if (count == 0L) 0.0 else sqrt(sumSquares[index] / count.toDouble())
    }
    val scale = max(
      NORMALIZATION_FLOOR,
      max(rawRms.maxOrNull() ?: 0.0, peaks.maxOrNull() ?: 0.0)
    )
    return WaveformData(
      durationMs = durationMs,
      binCount = binCount,
      rms = rawRms.mapToDoubleArray { (it / scale).coerceIn(0.0, 1.0) },
      peak = peaks.mapToDoubleArray { (it / scale).coerceIn(0.0, 1.0) }
    ).requireValid()
  }

  private fun DoubleArray.mapToDoubleArray(transform: (Double) -> Double): DoubleArray =
    DoubleArray(size) { index -> transform(this[index]) }

  private companion object {
    const val NORMALIZATION_FLOOR = 1e-9
  }
}

internal object PcmFrameReader {
  fun consume(
    buffer: ByteBuffer,
    channelCount: Int,
    pcmEncoding: Int,
    onFrame: (DoubleArray) -> Unit
  ) {
    require(channelCount in 1..2)
    val bytesPerSample = when (pcmEncoding) {
      AudioFormat.ENCODING_PCM_8BIT -> 1
      AudioFormat.ENCODING_PCM_16BIT -> 2
      AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3
      AudioFormat.ENCODING_PCM_32BIT,
      AudioFormat.ENCODING_PCM_FLOAT -> 4
      else -> throw IllegalArgumentException("Unsupported PCM encoding: $pcmEncoding")
    }
    val frameBytes = bytesPerSample * channelCount
    val pcm = buffer.slice().order(ByteOrder.LITTLE_ENDIAN)
    val samples = DoubleArray(channelCount)
    while (pcm.remaining() >= frameBytes) {
      for (channel in 0 until channelCount) {
        samples[channel] = readSample(pcm, pcmEncoding)
      }
      onFrame(samples)
    }
  }

  private fun readSample(buffer: ByteBuffer, encoding: Int): Double = when (encoding) {
    AudioFormat.ENCODING_PCM_8BIT -> ((buffer.get().toInt() and 0xff) - 128) / 128.0
    AudioFormat.ENCODING_PCM_16BIT -> buffer.short / 32768.0
    AudioFormat.ENCODING_PCM_24BIT_PACKED -> {
      var value = (buffer.get().toInt() and 0xff) or
        ((buffer.get().toInt() and 0xff) shl 8) or
        ((buffer.get().toInt() and 0xff) shl 16)
      if ((value and 0x800000) != 0) value = value or -0x1000000
      value / 8388608.0
    }
    AudioFormat.ENCODING_PCM_32BIT -> buffer.int / 2147483648.0
    AudioFormat.ENCODING_PCM_FLOAT -> buffer.float.toDouble().coerceIn(-1.0, 1.0)
    else -> error("Unsupported PCM encoding")
  }
}
