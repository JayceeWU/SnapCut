package expo.modules.snapcutmedia.preview

import org.junit.Assert.assertEquals
import org.junit.Test

class PreviewEnvelopeClockTest {
  @Test
  fun `natural flush advances across leading gap and later clip`() {
    val clock = PreviewEnvelopeClock()
    clock.requestSeekPositionMs(0)
    clock.flush(48_000)
    clock.advance(48_000)
    clock.flush(48_000)
    assertEquals(1_000_000L, clock.positionUs(0, 48_000))
    clock.advance(24_000)
    clock.flush(48_000)
    assertEquals(1_500_000L, clock.positionUs(0, 48_000))
  }

  @Test
  fun `seek anchor is consumed on flush and starts mid fade`() {
    val clock = PreviewEnvelopeClock()
    clock.requestSeekPositionMs(0)
    clock.flush(48_000)
    clock.advance(24_000)
    clock.requestSeekPositionMs(3_250)
    // Old queued PCM remains on the old clock until Media3 performs the seek flush.
    assertEquals(500_000L, clock.positionUs(0, 48_000))
    clock.flush(48_000)
    assertEquals(3_250_000L, clock.positionUs(0, 48_000))
  }

  @Test
  fun `format changing transition advances with the previous stream rate`() {
    val clock = PreviewEnvelopeClock()
    clock.requestSeekPositionMs(0)
    clock.flush(44_100)
    clock.advance(44_100)
    clock.flush(48_000)
    assertEquals(1_000_000L, clock.positionUs(0, 48_000))
  }
}
