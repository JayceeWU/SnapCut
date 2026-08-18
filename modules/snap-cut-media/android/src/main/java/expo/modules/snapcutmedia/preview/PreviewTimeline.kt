package expo.modules.snapcutmedia.preview

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.TrackId
import expo.modules.snapcutmedia.timeline.TimelineAudio

internal enum class PreviewMode(val wireValue: String) {
  SELECTION("selection"),
  COMPOSITION("composition")
}

internal data class PreviewClip(
  val clipId: String,
  val sourceId: String,
  val audioFileUri: String,
  val startMs: Long,
  val endMs: Long,
  val trackId: TrackId = TrackId.TRACK_1,
  val timelineStartMs: Long = 0L,
  val gain: Double = 1.0,
  val fadeInMs: Long = 0L,
  val fadeOutMs: Long = 0L
) {
  val durationMs: Long get() = endMs - startMs
  val timelineEndMs: Long get() = Math.addExact(timelineStartMs, durationMs)
}

internal data class PreviewPosition(
  val clipIndex: Int?,
  val clipId: String?,
  val compositionPositionMs: Long
)

internal data class TrackPlaylistItem(
  val clip: PreviewClip?,
  val timelineStartMs: Long,
  val timelineEndMs: Long
) {
  val durationMs: Long get() = timelineEndMs - timelineStartMs
}

internal data class TrackSeekTarget(
  val itemIndex: Int,
  val positionInItemMs: Long
)

internal data class PreviewTrackPlaylist(
  val trackId: TrackId,
  val items: List<TrackPlaylistItem>,
  val durationMs: Long
) {
  fun globalPosition(itemIndex: Int, itemPositionMs: Long): Long {
    val item = items[itemIndex.coerceIn(items.indices)]
    return Math.addExact(
      item.timelineStartMs,
      itemPositionMs.coerceIn(0L, item.durationMs)
    )
  }

  fun seekTarget(positionMs: Long): TrackSeekTarget {
    val position = positionMs.coerceIn(0L, durationMs)
    if (position == durationMs) {
      val item = items.last()
      return TrackSeekTarget(items.lastIndex, item.durationMs)
    }
    val index = items.binarySearch { item ->
      when {
        position < item.timelineStartMs -> 1
        position >= item.timelineEndMs -> -1
        else -> 0
      }
    }.takeIf { it >= 0 } ?: throw mediaError(SnapCutMediaError.PREVIEW_SEEK_FAILED)
    return TrackSeekTarget(index, position - items[index].timelineStartMs)
  }
}

internal class PreviewTimeline private constructor(
  val mode: PreviewMode,
  val clips: List<PreviewClip>,
  val tracks: List<PreviewTrackPlaylist>,
  val durationMs: Long
) {
  fun positionAt(positionMs: Long): PreviewPosition {
    val position = positionMs.coerceIn(0L, durationMs)
    val indexed = clips.withIndex().firstOrNull { (_, clip) ->
      position >= clip.timelineStartMs && position < clip.timelineEndMs
    }
    return PreviewPosition(indexed?.index, indexed?.value?.clipId, position)
  }

  companion object {
    private const val MINIMUM_CLIP_DURATION_MS = 100L

    fun create(mode: PreviewMode, inputClips: List<PreviewClip>): PreviewTimeline {
      if (inputClips.isEmpty() || (mode == PreviewMode.SELECTION && inputClips.size !in 1..2)) {
        throw mediaError(SnapCutMediaError.INVALID_REQUEST)
      }
      val normalized = if (mode == PreviewMode.SELECTION) {
        var timelineStartMs = 0L
        inputClips.map { clip ->
          val normalizedClip = clip.copy(
            trackId = TrackId.TRACK_1,
            timelineStartMs = timelineStartMs
          )
          timelineStartMs = runCatching(normalizedClip::timelineEndMs).getOrElse {
            throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE, cause = it)
          }
          normalizedClip
        }
      } else {
        inputClips.sortedWith(
          compareBy<PreviewClip> { it.timelineStartMs }
            .thenBy { it.trackId.value }
            .thenBy { it.clipId }
        )
      }
      val clipIds = hashSetOf<String>()
      normalized.forEach { clip ->
        if (
          clip.clipId.isBlank() ||
          !clipIds.add(clip.clipId) ||
          clip.sourceId.isBlank() ||
          clip.audioFileUri.isBlank() ||
          clip.startMs < 0L ||
          clip.durationMs < MINIMUM_CLIP_DURATION_MS ||
          clip.timelineStartMs < 0L ||
          !clip.gain.isFinite() ||
          clip.gain !in 0.0..1.0 ||
          !TimelineAudio.isSupportedFadeDurationMs(clip.fadeInMs) ||
          !TimelineAudio.isSupportedFadeDurationMs(clip.fadeOutMs) ||
          clip.fadeInMs + clip.fadeOutMs > clip.durationMs
        ) throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
        runCatching(clip::timelineEndMs).getOrElse {
          throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE, cause = it)
        }
      }
      normalized.groupBy(PreviewClip::trackId).values.forEach { track ->
        track.zipWithNext().forEach { (left, right) ->
          if (left.timelineEndMs > right.timelineStartMs) {
            throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
          }
        }
      }
      val durationMs = normalized.maxOf(PreviewClip::timelineEndMs)
      val tracks = normalized.groupBy(PreviewClip::trackId)
        .toSortedMap(compareBy(TrackId::value))
        .map { (trackId, clips) -> buildTrack(trackId, clips, durationMs) }
      return PreviewTimeline(mode, normalized, tracks, durationMs)
    }

    private fun buildTrack(
      trackId: TrackId,
      clips: List<PreviewClip>,
      durationMs: Long
    ): PreviewTrackPlaylist {
      val items = mutableListOf<TrackPlaylistItem>()
      var cursor = 0L
      clips.forEach { clip ->
        if (clip.timelineStartMs > cursor) {
          items += TrackPlaylistItem(null, cursor, clip.timelineStartMs)
        }
        items += TrackPlaylistItem(clip, clip.timelineStartMs, clip.timelineEndMs)
        cursor = clip.timelineEndMs
      }
      if (cursor < durationMs) items += TrackPlaylistItem(null, cursor, durationMs)
      return PreviewTrackPlaylist(trackId, items, durationMs)
    }
  }
}
