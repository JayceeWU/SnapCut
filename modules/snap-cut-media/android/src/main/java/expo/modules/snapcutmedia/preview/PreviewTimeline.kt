package expo.modules.snapcutmedia.preview

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError

internal enum class PreviewMode(val wireValue: String) {
  SELECTION("selection"),
  COMPOSITION("composition")
}

internal data class PreviewClip(
  val clipId: String,
  val sourceId: String,
  val audioFileUri: String,
  val startMs: Long,
  val endMs: Long
) {
  val durationMs: Long
    get() = endMs - startMs
}

internal data class PreviewPosition(
  val clipIndex: Int,
  val clipId: String,
  val positionInClipMs: Long,
  val compositionPositionMs: Long
)

internal data class PreviewSeekTarget(
  val clipIndex: Int,
  val positionInClipMs: Long,
  val compositionPositionMs: Long
)

/**
 * Immutable prefix-sum timeline. ExoPlayer positions are item-relative because
 * every MediaItem is clipped; React Native positions are preview-relative.
 */
internal class PreviewTimeline private constructor(
  val mode: PreviewMode,
  val clips: List<PreviewClip>,
  private val clipStartsMs: LongArray,
  val durationMs: Long
) {
  fun position(currentClipIndex: Int, itemPositionMs: Long): PreviewPosition {
    val index = currentClipIndex.coerceIn(0, clips.lastIndex)
    val clip = clips[index]
    val localPosition = itemPositionMs.coerceIn(0L, clip.durationMs)
    return PreviewPosition(
      clipIndex = index,
      clipId = clip.clipId,
      positionInClipMs = localPosition,
      compositionPositionMs = Math.addExact(clipStartsMs[index], localPosition)
    )
  }

  fun seekTarget(positionMs: Long): PreviewSeekTarget {
    val safePosition = positionMs.coerceIn(0L, durationMs)
    if (safePosition == durationMs) {
      val index = clips.lastIndex
      return PreviewSeekTarget(index, clips[index].durationMs, safePosition)
    }

    var low = 0
    var high = clips.lastIndex
    while (low < high) {
      val middle = (low + high) ushr 1
      val clipEnd = Math.addExact(clipStartsMs[middle], clips[middle].durationMs)
      if (safePosition < clipEnd) high = middle else low = middle + 1
    }
    return PreviewSeekTarget(
      clipIndex = low,
      positionInClipMs = safePosition - clipStartsMs[low],
      compositionPositionMs = safePosition
    )
  }

  companion object {
    private const val MINIMUM_CLIP_DURATION_MS = 100L

    fun create(mode: PreviewMode, inputClips: List<PreviewClip>): PreviewTimeline {
      if (inputClips.isEmpty() || (mode == PreviewMode.SELECTION && inputClips.size != 1)) {
        throw mediaError(SnapCutMediaError.INVALID_REQUEST)
      }

      val clips = inputClips.toList()
      val starts = LongArray(clips.size)
      val clipIds = hashSetOf<String>()
      var total = 0L
      clips.forEachIndexed { index, clip ->
        if (
          clip.clipId.isBlank() ||
          !clipIds.add(clip.clipId) ||
          clip.sourceId.isBlank() ||
          clip.audioFileUri.isBlank() ||
          clip.startMs < 0L ||
          clip.endMs <= clip.startMs ||
          clip.durationMs < MINIMUM_CLIP_DURATION_MS
        ) {
          throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
        }
        starts[index] = total
        total = try {
          Math.addExact(total, clip.durationMs)
        } catch (error: ArithmeticException) {
          throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE, cause = error)
        }
      }
      return PreviewTimeline(mode, clips, starts, total)
    }
  }
}
