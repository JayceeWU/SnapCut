package expo.modules.snapcutmedia.timeline

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.NativePreviewClip
import expo.modules.snapcutmedia.models.TrackId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.sqrt

class TimelineAudioTest {
  @Test
  fun `validates two tracks and derives maximum end`() {
    val clips = listOf(
      clip("a", TrackId.TRACK_1, 0, 1_000),
      clip("b", TrackId.TRACK_2, 500, 2_000)
    )
    assertEquals(2_500L, TimelineAudio.durationMs(clips))
  }

  @Test(expected = SnapCutMediaException::class)
  fun `rejects overlap on one track`() {
    TimelineAudio.validate(
      listOf(
        clip("a", TrackId.TRACK_1, 0, 1_000),
        clip("b", TrackId.TRACK_1, 999, 1_000)
      )
    )
  }

  @Test
  fun `stream copy requires contiguous unity clips without fades`() {
    assertTrue(
      TimelineAudio.streamCopyEligible(
        listOf(
          clip("a", TrackId.TRACK_1, 0, 1_000),
          clip("b", TrackId.TRACK_1, 1_000, 1_000)
        )
      )
    )
    assertFalse(TimelineAudio.streamCopyEligible(listOf(clip("a", TrackId.TRACK_1, 5, 1_000))))
    assertFalse(
      TimelineAudio.streamCopyEligible(
        listOf(clip("a", TrackId.TRACK_1, 0, 1_000, gain = 0.5))
      )
    )
    assertFalse(
      TimelineAudio.streamCopyEligible(
        listOf(clip("a", TrackId.TRACK_1, 0, 1_000, fadeInMs = 500))
      )
    )
  }

  @Test
  fun `equal power fades use the expected midpoint`() {
    val expected = sqrt(0.5)
    assertEquals(0.0, TimelineAudio.envelope(0.0, 2_000, 1_000, 0), 0.000001)
    assertEquals(expected, TimelineAudio.envelope(500.0, 2_000, 1_000, 0), 0.000001)
    assertEquals(1.0, TimelineAudio.envelope(1_000.0, 2_000, 1_000, 0), 0.000001)
    assertEquals(expected, TimelineAudio.envelope(1_500.0, 2_000, 0, 1_000), 0.000001)
    assertEquals(0.0, TimelineAudio.envelope(2_000.0, 2_000, 0, 1_000), 0.000001)
  }

  @Test
  fun `fade contract accepts 500 millisecond steps through eight seconds`() {
    val maximum = clip(
      "maximum",
      TrackId.TRACK_1,
      0,
      16_000,
      fadeInMs = 8_000,
      fadeOutMs = 8_000
    )
    assertEquals(listOf(maximum), TimelineAudio.validate(listOf(maximum)))
    assertTrue(TimelineAudio.isSupportedFadeDurationMs(2_500))
    assertTrue(TimelineAudio.isSupportedFadeDurationMs(8_000))

    listOf(250L, 8_500L).forEach { invalidFadeMs ->
      assertEquals(
        "INVALID_CLIP_RANGE",
        assertThrows(SnapCutMediaException::class.java) {
          TimelineAudio.validate(
            listOf(clip("invalid-$invalidFadeMs", TrackId.TRACK_1, 0, 12_000, fadeInMs = invalidFadeMs))
          )
        }.code
      )
    }
    assertEquals(
      "INVALID_CLIP_RANGE",
      assertThrows(SnapCutMediaException::class.java) {
        TimelineAudio.validate(
          listOf(
            clip(
              "excessive",
              TrackId.TRACK_1,
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

  @Test
  fun `mixer sums and hard clamps finite samples`() {
    val mixed = TimelineAudio.mixHardClamped(
      floatArrayOf(0.75f, -0.75f, Float.NaN),
      floatArrayOf(0.75f, -0.75f, 0.25f)
    )
    assertTrue(mixed.contentEquals(floatArrayOf(1f, -1f, 0.25f)))
    assertTrue(
      TimelineAudio.hardClamp(floatArrayOf(1.5f, -1.5f, Float.NaN))
        .contentEquals(floatArrayOf(1f, -1f, 0f))
    )
  }

  @Test
  fun `clipping risk is reported only for audible cross-track overlap`() {
    val first = clip("a", TrackId.TRACK_1, 0, 1_000)
    assertTrue(TimelineAudio.mayHardClip(listOf(first, clip("b", TrackId.TRACK_2, 500, 1_000))))
    assertFalse(TimelineAudio.mayHardClip(listOf(first, clip("b", TrackId.TRACK_2, 1_000, 1_000))))
    assertFalse(
      TimelineAudio.mayHardClip(
        listOf(first, clip("b", TrackId.TRACK_2, 500, 1_000, gain = 0.0))
      )
    )
  }

  private fun clip(
    id: String,
    track: TrackId,
    timelineStartMs: Long,
    durationMs: Long,
    gain: Double = 1.0,
    fadeInMs: Long = 0L,
    fadeOutMs: Long = 0L
  ) = NativePreviewClip(
    clipId = id,
    sourceId = "source-$id",
    audioFileUri = "file:///source-$id.m4a",
    startMs = 0,
    endMs = durationMs,
    trackId = track,
    timelineStartMs = timelineStartMs,
    gain = gain,
    fadeInMs = fadeInMs,
    fadeOutMs = fadeOutMs
  )
}
