package expo.modules.snapcutmedia.preview

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.TrackId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class PreviewTimelineTest {
  @Test
  fun `selection normalizes a source range onto a zero based preview`() {
    val timeline = PreviewTimeline.create(
      PreviewMode.SELECTION,
      listOf(clip("clip-a", 12_000, 42_000, TrackId.TRACK_2, 90_000))
    )

    assertEquals(30_000L, timeline.durationMs)
    assertEquals(TrackId.TRACK_1, timeline.clips.single().trackId)
    assertEquals(0L, timeline.clips.single().timelineStartMs)
    assertEquals(PreviewPosition(0, "clip-a", 17_500L), timeline.positionAt(17_500L))
  }

  @Test
  fun `composition includes gaps and overlapping second track`() {
    val timeline = PreviewTimeline.create(
      PreviewMode.COMPOSITION,
      listOf(
        clip("first", 0, 1_000, TrackId.TRACK_1, 0),
        clip("second", 0, 300, TrackId.TRACK_1, 1_300),
        clip("overlay", 0, 700, TrackId.TRACK_2, 500)
      )
    )

    assertEquals(1_600L, timeline.durationMs)
    assertEquals(2, timeline.tracks.size)
    assertEquals(listOf(1_000L, 300L, 300L), timeline.tracks[0].items.map { it.durationMs })
    assertEquals(TrackSeekTarget(1, 100L), timeline.tracks[0].seekTarget(1_100L))
    assertEquals("first", timeline.positionAt(500L).clipId)
    assertNull(timeline.positionAt(1_250L).clipId)
  }

  @Test
  fun `accepts stepped fades through six seconds`() {
    val timeline = PreviewTimeline.create(
      PreviewMode.COMPOSITION,
      listOf(
        clip(
          "maximum-fades",
          0,
          12_000,
          fadeInMs = 6_000,
          fadeOutMs = 6_000
        )
      )
    )

    assertEquals(6_000L, timeline.clips.single().fadeInMs)
    assertEquals(6_000L, timeline.clips.single().fadeOutMs)
  }

  @Test
  fun `rejects overlap on one track and invalid selections`() {
    assertEquals(
      "INVALID_REQUEST",
      assertThrows(SnapCutMediaException::class.java) {
        PreviewTimeline.create(PreviewMode.COMPOSITION, emptyList())
      }.code
    )
    assertEquals(
      "INVALID_REQUEST",
      assertThrows(SnapCutMediaException::class.java) {
        PreviewTimeline.create(
          PreviewMode.SELECTION,
          listOf(clip("one", 0, 100), clip("two", 0, 100))
        )
      }.code
    )
    assertEquals(
      "INVALID_CLIP_RANGE",
      assertThrows(SnapCutMediaException::class.java) {
        PreviewTimeline.create(
          PreviewMode.COMPOSITION,
          listOf(
            clip("one", 0, 1_000, timelineStartMs = 0),
            clip("two", 0, 1_000, timelineStartMs = 500)
          )
        )
      }.code
    )
    assertEquals(
      "INVALID_CLIP_RANGE",
      assertThrows(SnapCutMediaException::class.java) {
        PreviewTimeline.create(
          PreviewMode.SELECTION,
          listOf(clip("invalid-fade", 0, 1_000, fadeInMs = 250))
        )
      }.code
    )
    assertEquals(
      "INVALID_CLIP_RANGE",
      assertThrows(SnapCutMediaException::class.java) {
        PreviewTimeline.create(
          PreviewMode.SELECTION,
          listOf(clip("over-limit-fade", 0, 12_000, fadeInMs = 6_500))
        )
      }.code
    )
    assertEquals(
      "INVALID_CLIP_RANGE",
      assertThrows(SnapCutMediaException::class.java) {
        PreviewTimeline.create(
          PreviewMode.COMPOSITION,
          listOf(
            clip(
              "excessive-total-fade",
              0,
              6_000,
              fadeInMs = 3_500,
              fadeOutMs = 3_000
            )
          )
        )
      }.code
    )
  }

  private fun clip(
    id: String,
    startMs: Long,
    endMs: Long,
    trackId: TrackId = TrackId.TRACK_1,
    timelineStartMs: Long = 0L,
    fadeInMs: Long = 0L,
    fadeOutMs: Long = 0L
  ) = PreviewClip(
    id,
    "source-$id",
    "file:///private/$id/source.m4a",
    startMs,
    endMs,
    trackId,
    timelineStartMs,
    fadeInMs = fadeInMs,
    fadeOutMs = fadeOutMs
  )
}
