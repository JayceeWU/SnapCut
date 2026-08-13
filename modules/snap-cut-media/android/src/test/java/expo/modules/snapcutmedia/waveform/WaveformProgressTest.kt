package expo.modules.snapcutmedia.waveform

import org.junit.Assert.assertEquals
import org.junit.Test

class WaveformProgressTest {
  @Test
  fun `processing progress is throttled to at most every 250 milliseconds`() {
    var now = 0L
    val events = mutableListOf<WaveformProgress>()
    val reporter = WaveformProgressReporter({ event -> events.add(event) }) { now }

    reporter.report("processing", 0.0)
    now = 249L
    reporter.report("processing", 0.5)
    now = 250L
    reporter.report("processing", 1.5)
    reporter.report("writing", null, force = true)

    assertEquals(3, events.size)
    assertEquals(1.0, events[1].fraction!!, 0.0)
    assertEquals("writing", events[2].stage)
  }
}
