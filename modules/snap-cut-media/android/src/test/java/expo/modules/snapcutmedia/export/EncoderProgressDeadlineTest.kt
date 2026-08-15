package expo.modules.snapcutmedia.export

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EncoderProgressDeadlineTest {
  @Test
  fun `input or output progress extends the no-progress deadline`() {
    var now = 10L
    val deadline = EncoderProgressDeadline(timeoutNs = 100L, nowNs = { now })

    now = 109L
    assertFalse(deadline.hasExpired())
    deadline.markProgress()

    now = 208L
    assertFalse(deadline.hasExpired())
    now = 209L
    assertTrue(deadline.hasExpired())
  }
}
