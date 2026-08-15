package expo.modules.snapcutmedia.preview

import org.junit.Assert.assertEquals
import org.junit.Test

class PreviewPauseCoordinatorTest {
  @Test
  fun `pause stops ticker then both tracks and emits exactly one acknowledgement`() {
    val events = mutableListOf<String>()
    var acknowledgements = 0

    PreviewPauseCoordinator().pause(
      trackCount = 2,
      stopProgressTicker = { events += "ticker-stopped" },
      clearResumeIntent = { events += "resume-cleared" },
      pauseTrack = { index -> events += "track-$index-paused" },
      abandonAudioFocus = { events += "focus-abandoned" },
      acknowledgePaused = {
        acknowledgements += 1
        events += "pause-ack"
      }
    )

    assertEquals(
      listOf(
        "ticker-stopped",
        "resume-cleared",
        "track-0-paused",
        "track-1-paused",
        "focus-abandoned",
        "pause-ack"
      ),
      events
    )
    assertEquals(1, acknowledgements)
  }
}
