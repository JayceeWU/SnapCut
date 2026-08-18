package expo.modules.snapcutmedia.exportmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExportMathTest {
  @Test
  fun `M4A estimate uses Android 29 compatible arithmetic`() {
    assertEquals(1_065_536L, ExportMath.estimateM4aBytes(1_000_000L))
  }

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
    val mp3 = ExportMath.estimateMp3Bytes(1_000L)

    assertEquals(165_536L, m4a)
    assertEquals(105_536L, mp3)
    assertTrue(ExportMath.requiredFreeBytes(mp3) > mp3 * 2L)
    assertTrue(ExportMath.requiredFreeBytes(mp3) >= ExportMath.WORKING_MARGIN_BYTES)
  }
}
