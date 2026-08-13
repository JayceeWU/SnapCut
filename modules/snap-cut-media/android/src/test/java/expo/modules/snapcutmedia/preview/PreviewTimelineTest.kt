package expo.modules.snapcutmedia.preview

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PreviewTimelineTest {
  @Test
  fun `selection maps clipped item positions onto a zero based preview`() {
    val timeline = PreviewTimeline.create(
      PreviewMode.SELECTION,
      listOf(clip("clip-a", startMs = 12_000L, endMs = 42_000L))
    )

    assertEquals(30_000L, timeline.durationMs)
    assertEquals(
      PreviewPosition(0, "clip-a", 0L, 0L),
      timeline.position(currentClipIndex = 0, itemPositionMs = -20L)
    )
    assertEquals(
      PreviewPosition(0, "clip-a", 17_500L, 17_500L),
      timeline.position(currentClipIndex = 0, itemPositionMs = 17_500L)
    )
    assertEquals(
      PreviewSeekTarget(0, 30_000L, 30_000L),
      timeline.seekTarget(30_000L)
    )
  }

  @Test
  fun `composition preserves clip order and maps exact boundaries to the next item`() {
    val timeline = PreviewTimeline.create(
      PreviewMode.COMPOSITION,
      listOf(
        clip("first", startMs = 5_000L, endMs = 6_000L),
        clip("second", startMs = 10_000L, endMs = 10_300L),
        clip("third", startMs = 0L, endMs = 700L)
      )
    )

    assertEquals(listOf("first", "second", "third"), timeline.clips.map { it.clipId })
    assertEquals(2_000L, timeline.durationMs)
    assertEquals(PreviewSeekTarget(0, 999L, 999L), timeline.seekTarget(999L))
    assertEquals(PreviewSeekTarget(1, 0L, 1_000L), timeline.seekTarget(1_000L))
    assertEquals(PreviewSeekTarget(1, 299L, 1_299L), timeline.seekTarget(1_299L))
    assertEquals(PreviewSeekTarget(2, 0L, 1_300L), timeline.seekTarget(1_300L))
    assertEquals(PreviewSeekTarget(2, 700L, 2_000L), timeline.seekTarget(2_000L))
    assertEquals(PreviewSeekTarget(2, 700L, 2_000L), timeline.seekTarget(Long.MAX_VALUE))
    assertEquals(
      PreviewPosition(1, "second", 125L, 1_125L),
      timeline.position(currentClipIndex = 1, itemPositionMs = 125L)
    )
  }

  @Test
  fun `rejects empty multi item selection and sub minimum clip ranges`() {
    val empty = assertThrows(SnapCutMediaException::class.java) {
      PreviewTimeline.create(PreviewMode.COMPOSITION, emptyList())
    }
    assertEquals("INVALID_REQUEST", empty.code)

    val multipleSelection = assertThrows(SnapCutMediaException::class.java) {
      PreviewTimeline.create(
        PreviewMode.SELECTION,
        listOf(clip("one", 0L, 100L), clip("two", 0L, 100L))
      )
    }
    assertEquals("INVALID_REQUEST", multipleSelection.code)

    val tooShort = assertThrows(SnapCutMediaException::class.java) {
      PreviewTimeline.create(
        PreviewMode.COMPOSITION,
        listOf(clip("short", 20L, 119L))
      )
    }
    assertEquals("INVALID_CLIP_RANGE", tooShort.code)

    val duplicateId = assertThrows(SnapCutMediaException::class.java) {
      PreviewTimeline.create(
        PreviewMode.COMPOSITION,
        listOf(clip("duplicate", 0L, 100L), clip("duplicate", 200L, 400L))
      )
    }
    assertEquals("INVALID_CLIP_RANGE", duplicateId.code)
  }

  private fun clip(
    id: String,
    startMs: Long,
    endMs: Long
  ) = PreviewClip(
    clipId = id,
    sourceId = "source-$id",
    audioFileUri = "file:///private/$id/source.m4a",
    startMs = startMs,
    endMs = endMs
  )
}
