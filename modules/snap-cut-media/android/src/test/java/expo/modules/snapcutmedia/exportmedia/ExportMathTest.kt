package expo.modules.snapcutmedia.exportmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExportMathTest {
  @Test
  fun `decoded rate and channel policy follows the export contract`() {
    assertEquals(32_000, ExportMath.outputSampleRate(listOf(32_000, 32_000)))
    assertEquals(44_100, ExportMath.outputSampleRate(listOf(22_050, 44_100)))
    assertEquals(48_000, ExportMath.outputSampleRate(listOf(44_100, 48_000)))
    assertEquals(1, ExportMath.outputChannelCount(listOf(1, 1)))
    assertEquals(2, ExportMath.outputChannelCount(listOf(1, 2)))
  }

  @Test
  fun `format estimates are conservative and free space includes two copies plus margins`() {
    val m4a = ExportMath.estimateM4aBytes(100_000L)
    val flac = ExportMath.estimateFlacBytes(1_000L, 48_000, 2)
    val mp3 = ExportMath.estimateMp3Bytes(1_000L)

    assertEquals(165_536L, m4a)
    assertEquals(293_760L, flac)
    assertEquals(105_536L, mp3)
    assertTrue(ExportMath.requiredFreeBytes(flac) > flac * 2L)
    assertTrue(ExportMath.requiredFreeBytes(flac) >= ExportMath.WORKING_MARGIN_BYTES)
  }
}
