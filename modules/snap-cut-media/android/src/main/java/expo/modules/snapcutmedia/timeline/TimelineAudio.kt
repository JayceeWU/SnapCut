package expo.modules.snapcutmedia.timeline

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.NativePreviewClip
import expo.modules.snapcutmedia.models.TrackId
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

internal object TimelineAudio {
  const val FADE_DURATION_STEP_MS = 500L
  const val MAX_FADE_DURATION_MS = 8_000L

  fun isSupportedFadeDurationMs(value: Long): Boolean =
    value in 0L..MAX_FADE_DURATION_MS && value % FADE_DURATION_STEP_MS == 0L

  fun validate(clips: List<NativePreviewClip>): List<NativePreviewClip> {
    if (clips.isEmpty()) throw mediaError(SnapCutMediaError.EXPORT_EMPTY_COMPOSITION)
    val ids = hashSetOf<String>()
    val ordered = clips.sortedWith(
      compareBy<NativePreviewClip> { it.timelineStartMs }
        .thenBy { it.trackId.value }
        .thenBy { it.clipId }
    )
    ordered.forEach { clip ->
      val durationMs = clip.endMs - clip.startMs
      if (
        clip.clipId.isBlank() ||
        clip.sourceId.isBlank() ||
        clip.audioFileUri.isBlank() ||
        !ids.add(clip.clipId) ||
        clip.startMs < 0L ||
        durationMs < MINIMUM_CLIP_DURATION_MS ||
        clip.timelineStartMs < 0L ||
        !clip.gain.isFinite() ||
        clip.gain !in 0.0..1.0 ||
        !isSupportedFadeDurationMs(clip.fadeInMs) ||
        !isSupportedFadeDurationMs(clip.fadeOutMs) ||
        clip.fadeInMs + clip.fadeOutMs > durationMs
      ) {
        throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
      }
      try {
        Math.addExact(clip.timelineStartMs, durationMs)
      } catch (error: ArithmeticException) {
        throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE, cause = error)
      }
    }
    ordered.groupBy { it.trackId }.values.forEach { track ->
      track.zipWithNext().forEach { (left, right) ->
        if (timelineEndMs(left) > right.timelineStartMs) {
          throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
        }
      }
    }
    return ordered
  }

  fun durationMs(clips: List<NativePreviewClip>): Long =
    validate(clips).maxOf(::timelineEndMs)

  fun streamCopyEligible(clips: List<NativePreviewClip>): Boolean {
    val ordered = runCatching { validate(clips) }.getOrNull() ?: return false
    var cursorMs = 0L
    ordered.forEach { clip ->
      if (
        clip.timelineStartMs != cursorMs ||
        clip.gain != 1.0 ||
        clip.fadeInMs != 0L ||
        clip.fadeOutMs != 0L
      ) return false
      cursorMs = timelineEndMs(clip)
    }
    return cursorMs > 0L
  }

  fun mayHardClip(clips: List<NativePreviewClip>): Boolean {
    val audible = clips.filter { it.gain > 0.0 }
    val first = audible.filter { it.trackId == TrackId.TRACK_1 }
    val second = audible.filter { it.trackId == TrackId.TRACK_2 }
    return first.any { left ->
      second.any { right ->
        left.timelineStartMs < timelineEndMs(right) &&
          right.timelineStartMs < timelineEndMs(left)
      }
    }
  }

  fun envelope(
    positionMs: Double,
    durationMs: Long,
    fadeInMs: Long,
    fadeOutMs: Long
  ): Double {
    require(durationMs > 0L)
    require(isSupportedFadeDurationMs(fadeInMs) && isSupportedFadeDurationMs(fadeOutMs))
    require(fadeInMs + fadeOutMs <= durationMs)
    val position = positionMs.coerceIn(0.0, durationMs.toDouble())
    val fadeIn = if (fadeInMs == 0L || position >= fadeInMs) {
      1.0
    } else {
      sin(PI * 0.5 * position / fadeInMs.toDouble())
    }
    val fadeOutStart = durationMs - fadeOutMs
    val fadeOut = if (fadeOutMs == 0L || position <= fadeOutStart) {
      1.0
    } else {
      cos(PI * 0.5 * (position - fadeOutStart) / fadeOutMs.toDouble())
    }
    return (fadeIn * fadeOut).coerceIn(0.0, 1.0)
  }

  fun applyGainAndFades(
    interleaved: FloatArray,
    channels: Int,
    firstClipFrame: Long,
    sampleRateHz: Int,
    clipDurationMs: Long,
    gain: Double,
    fadeInMs: Long,
    fadeOutMs: Long
  ) {
    require(channels in 1..2 && sampleRateHz > 0 && firstClipFrame >= 0L)
    require(interleaved.size % channels == 0)
    require(gain.isFinite() && gain in 0.0..1.0)
    val frames = interleaved.size / channels
    repeat(frames) { frame ->
      val positionMs = (firstClipFrame + frame).toDouble() * 1_000.0 / sampleRateHz
      val multiplier = gain * envelope(positionMs, clipDurationMs, fadeInMs, fadeOutMs)
      val firstSample = frame * channels
      repeat(channels) { channel ->
        val index = firstSample + channel
        val sample = interleaved[index]
        interleaved[index] = if (sample.isFinite()) {
          (sample * multiplier).toFloat()
        } else {
          0f
        }
      }
    }
  }

  fun mixHardClamped(left: FloatArray, right: FloatArray): FloatArray {
    require(left.size == right.size)
    return FloatArray(left.size) { index ->
      val first = left[index].takeIf(Float::isFinite) ?: 0f
      val second = right[index].takeIf(Float::isFinite) ?: 0f
      (first + second).coerceIn(-1f, 1f)
    }
  }

  fun hardClamp(samples: FloatArray): FloatArray = FloatArray(samples.size) { index ->
    (samples[index].takeIf(Float::isFinite) ?: 0f).coerceIn(-1f, 1f)
  }

  fun timelineEndMs(clip: NativePreviewClip): Long =
    Math.addExact(clip.timelineStartMs, clip.endMs - clip.startMs)

  private const val MINIMUM_CLIP_DURATION_MS = 100L
}
