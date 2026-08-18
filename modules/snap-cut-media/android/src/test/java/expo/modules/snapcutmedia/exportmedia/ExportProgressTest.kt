package expo.modules.snapcutmedia.exportmedia

import org.junit.Assert.assertEquals
import org.junit.Test

class ExportProgressTest {
  @Test
  fun `same stage progress is throttled to one event per hundred milliseconds`() {
    var now = 0L
    val events = mutableListOf<ExportProgress>()
    val reporter = ExportProgressReporter({ event -> events.add(event) }) { now }

    reporter.report(ExportStage.MUXING, 0.0)
    now = 99L
    reporter.report(ExportStage.MUXING, 0.5)
    now = 100L
    reporter.report(ExportStage.MUXING, 2.0)
    reporter.report(ExportStage.VERIFYING, null, force = true)

    assertEquals(3, events.size)
    assertEquals(1.0, events[1].fraction!!, 0.0)
    assertEquals(ExportStage.VERIFYING, events[2].stage)
  }
}
