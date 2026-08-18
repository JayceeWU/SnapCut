package expo.modules.snapcutmedia.waveform

import android.media.AudioFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WaveformAccumulatorTest {
  @Test
  fun `8192 bin waveform is finite normalized and retains RMS plus peak`() {
    val accumulator = WaveformAccumulator(durationMs = 1000L, sampleRateHz = 8, binCount = 8192)
    repeat(8) { index ->
      accumulator.addFrame(doubleArrayOf(if (index == 7) 1.0 else 0.5))
    }

    val waveform = accumulator.finish()

    assertEquals(8192, waveform.binCount)
    assertEquals(8192, waveform.rms.size)
    assertEquals(8192, waveform.peak.size)
    assertTrue(waveform.rms.all { it.isFinite() && it in 0.0..1.0 })
    assertTrue(waveform.peak.all { it.isFinite() && it in 0.0..1.0 })
    assertEquals(1.0, waveform.peak.maxOrNull()!!, 0.0)
  }

  @Test
  fun `silent input avoids NaN through normalization floor`() {
    val accumulator = WaveformAccumulator(1000L, 1, 4)
    accumulator.addFrame(doubleArrayOf(0.0))
    val waveform = accumulator.finish()

    assertFalse(waveform.rms.any(Double::isNaN))
    assertFalse(waveform.peak.any(Double::isNaN))
  }

  @Test
  fun `PCM16 frames stream without retaining decoded file`() {
    val bytes = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).apply {
      putShort(32767)
      putShort((-32768).toShort())
      putShort(0)
      putShort(16384)
      flip()
    }
    val frames = mutableListOf<DoubleArray>()

    PcmFrameReader.consume(bytes, 2, AudioFormat.ENCODING_PCM_16BIT) {
      frames += it.copyOf()
    }

    assertEquals(2, frames.size)
    assertTrue(frames[0][0] > 0.99)
    assertEquals(-1.0, frames[0][1], 0.0)
  }

  @Test
  fun `waveform JSON has exact persisted keys and arrays`() {
    val data = WaveformData(10L, 2, doubleArrayOf(0.0, 1.0), doubleArrayOf(0.5, 1.0))
    val json = WaveformJson.encode(data)

    assertEquals(
      "{\"schemaVersion\":1,\"durationMs\":10,\"binCount\":2," +
        "\"rms\":[0.00000000,1.00000000],\"peak\":[0.50000000,1.00000000]}",
      json
    )
  }
}
