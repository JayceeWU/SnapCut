package expo.modules.snapcutmedia.export

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class DecodedPcmMathTest {
  @Test
  fun `clip frame selection uses exact ceil and a half-open interval`() {
    assertEquals(
      FrameSlice(45, 89),
      ClipFrameMath.slice(
        bufferPresentationTimeUs = 0,
        bufferFrameCount = 128,
        sampleRateHz = 44_100,
        clipStartMs = 1,
        clipEndMs = 2
      )
    )
    assertEquals(
      FrameSlice(100, 150),
      ClipFrameMath.slice(900_000, 200, 1_000, 1_000, 1_050)
    )
    assertEquals(44_100L, ClipFrameMath.durationFrames(1_000, 44_100))
  }

  @Test
  fun `selection clamps buffers completely outside the clip`() {
    assertEquals(FrameSlice(0, 0), ClipFrameMath.slice(2_000_000, 100, 48_000, 1_000, 1_100))
    assertEquals(FrameSlice(100, 100), ClipFrameMath.slice(0, 100, 48_000, 1_000, 1_100))
  }

  @Test
  fun `decoder reads little endian pcm and sanitizes invalid float samples`() {
    val signed16 = ByteBuffer.allocate(6).order(ByteOrder.LITTLE_ENDIAN)
      .putShort(Short.MIN_VALUE)
      .putShort(0)
      .putShort(Short.MAX_VALUE)
      .flip() as ByteBuffer
    assertArrayEquals(
      floatArrayOf(-1f, 0f, Short.MAX_VALUE / 32768f),
      DecodedPcm.readInterleaved(signed16, 1, PcmSampleEncoding.SIGNED_16),
      0f
    )

    val floatPcm = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
      .putFloat(Float.NaN)
      .putFloat(Float.POSITIVE_INFINITY)
      .putFloat(-2f)
      .putFloat(0.25f)
      .flip() as ByteBuffer
    assertArrayEquals(
      floatArrayOf(0f, 0f, -1f, 0.25f),
      DecodedPcm.readInterleaved(floatPcm, 2, PcmSampleEncoding.FLOAT_32),
      0f
    )
  }

  @Test
  fun `decoder rejects partial pcm frames`() {
    assertThrows(IllegalArgumentException::class.java) {
      DecodedPcm.readInterleaved(
        ByteBuffer.wrap(byteArrayOf(0, 1, 2)),
        2,
        PcmSampleEncoding.SIGNED_16
      )
    }
  }

  @Test
  fun `mono duplication and signed 24 quantization are deterministic`() {
    assertArrayEquals(
      floatArrayOf(-0.5f, -0.5f, 0f, 0f, 1f, 1f),
      DecodedPcm.convertChannels(floatArrayOf(-0.5f, Float.NaN, 2f), 1, 2),
      0f
    )
    assertArrayEquals(
      intArrayOf(-8_388_608, -4_194_304, 0, 4_194_304, 8_388_607, 0),
      DecodedPcm.quantizeSigned24(
        floatArrayOf(-1f, -0.5f, 0f, 0.5f, 1f, Float.NaN)
      )
    )
  }
}
