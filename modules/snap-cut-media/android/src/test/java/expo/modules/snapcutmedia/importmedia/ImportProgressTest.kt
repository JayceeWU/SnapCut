package expo.modules.snapcutmedia.importmedia

import org.junit.Assert.assertEquals
import org.junit.Test

class ImportProgressTest {
  @Test
  fun `same-stage progress is throttled to at most every 100 milliseconds`() {
    var now = 0L
    val events = mutableListOf<ImportProgress>()
    val reporter = ImportProgressReporter({ event -> events.add(event) }) { now }

    reporter.report(ImportStage.EXTRACTING_OR_COPYING, 0.0)
    now = 99L
    reporter.report(ImportStage.EXTRACTING_OR_COPYING, 0.5)
    now = 100L
    reporter.report(ImportStage.EXTRACTING_OR_COPYING, 1.5)
    reporter.report(ImportStage.VERIFYING, null)

    assertEquals(3, events.size)
    assertEquals(1.0, events[1].fraction!!, 0.0)
    assertEquals(ImportStage.VERIFYING, events[2].stage)
  }
}
