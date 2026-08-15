import { assertIntegerMilliseconds } from '@/utils/time';

import { DomainError } from './errors';
import { snapCutClipSchema, trackIdSchema } from './schemas';
import type { ClipTimelineEntry, SnapCutClip, TimelinePosition, TrackId } from './types';

function checkedTimelineEnd(startMs: number, durationMs: number): number {
  const endMs = startMs + durationMs;
  if (!Number.isSafeInteger(endMs)) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Composition timeline exceeds safe integer range');
  }
  return endMs;
}

export function clipDurationMs(clip: SnapCutClip): number {
  const parsed = snapCutClipSchema.parse(clip);
  return parsed.endMs - parsed.startMs;
}

export function clipTimelineEndMs(clip: SnapCutClip): number {
  const parsed = snapCutClipSchema.parse(clip) as SnapCutClip;
  return checkedTimelineEnd(parsed.timelineStartMs, clipDurationMs(parsed));
}

export function compositionDurationMs(clips: readonly SnapCutClip[]): number {
  return clips.reduce((maximum, clip) => Math.max(maximum, clipTimelineEndMs(clip)), 0);
}

export function trackTimelineEndMs(
  clips: readonly SnapCutClip[],
  trackIdInput: TrackId,
  excludeClipId?: string,
): number {
  const trackId = trackIdSchema.parse(trackIdInput) as TrackId;
  return clips.reduce(
    (maximum, clip) =>
      clip.trackId === trackId && clip.id !== excludeClipId
        ? Math.max(maximum, clipTimelineEndMs(clip))
        : maximum,
    0,
  );
}

export function buildClipTimeline(clips: readonly SnapCutClip[]): ClipTimelineEntry[] {
  const ids = new Set<string>();
  return clips
    .map((clip) => {
      const parsed = snapCutClipSchema.parse(clip) as SnapCutClip;
      if (ids.has(parsed.id)) {
        throw new DomainError('DUPLICATE_ID', `Duplicate clip ID: ${parsed.id}`);
      }
      ids.add(parsed.id);
      return {
        clipId: parsed.id,
        trackId: parsed.trackId,
        compositionStartMs: parsed.timelineStartMs,
        compositionEndMs: clipTimelineEndMs(parsed),
      };
    })
    .sort(
      (left, right) =>
        left.compositionStartMs - right.compositionStartMs ||
        left.trackId.localeCompare(right.trackId) ||
        left.clipId.localeCompare(right.clipId),
    );
}

export function mapTimelinePositionToClips(
  clips: readonly SnapCutClip[],
  compositionPositionMs: number,
): TimelinePosition[] {
  const positionMs = assertIntegerMilliseconds(compositionPositionMs, 'compositionPositionMs');
  const clipsById = new Map(clips.map((clip) => [clip.id, snapCutClipSchema.parse(clip)]));
  return buildClipTimeline(clips)
    .filter(
      (entry) => positionMs >= entry.compositionStartMs && positionMs < entry.compositionEndMs,
    )
    .map((entry) => {
      const clip = clipsById.get(entry.clipId)!;
      const positionInClipMs = positionMs - entry.compositionStartMs;
      return {
        clipId: entry.clipId,
        clipIndex: clips.findIndex(({ id }) => id === entry.clipId),
        positionInClipMs,
        sourcePositionMs: clip.startMs + positionInClipMs,
        compositionPositionMs: positionMs,
      };
    });
}

/** Backwards-compatible single-result mapping; Track 1 wins when tracks overlap. */
export function mapCompositionPosition(
  clips: readonly SnapCutClip[],
  compositionPositionMs: number,
): TimelinePosition | null {
  return mapTimelinePositionToClips(clips, compositionPositionMs)[0] ?? null;
}

export function findClipCollisionIds(
  clips: readonly SnapCutClip[],
  candidateInput: SnapCutClip,
  excludeClipId: string | undefined = candidateInput.id,
): string[] {
  const candidate = snapCutClipSchema.parse(candidateInput) as SnapCutClip;
  const candidateEndMs = clipTimelineEndMs(candidate);
  return clips
    .filter((clip) => {
      if (clip.id === excludeClipId || clip.trackId !== candidate.trackId) return false;
      return (
        candidate.timelineStartMs < clipTimelineEndMs(clip) && clip.timelineStartMs < candidateEndMs
      );
    })
    .map(({ id }) => id);
}

export function canPlaceClip(
  clips: readonly SnapCutClip[],
  candidate: SnapCutClip,
  excludeClipId: string | undefined = candidate.id,
): boolean {
  return findClipCollisionIds(clips, candidate, excludeClipId).length === 0;
}

/**
 * Finds the nearest legal start on one track. Candidates are the requested
 * position plus every gap boundary; equal-distance choices prefer the earlier
 * position so drag snapping is deterministic.
 */
export function snapClipTimelineStartMs(
  clips: readonly SnapCutClip[],
  candidateInput: SnapCutClip,
  requestedTimelineStartMs: number,
  trackIdInput: TrackId = candidateInput.trackId,
  excludeClipId: string | undefined = candidateInput.id,
): number {
  const requested = assertIntegerMilliseconds(requestedTimelineStartMs, 'requestedTimelineStartMs');
  const trackId = trackIdSchema.parse(trackIdInput) as TrackId;
  const candidate = snapCutClipSchema.parse({
    ...candidateInput,
    trackId,
    timelineStartMs: requested,
  }) as SnapCutClip;
  if (canPlaceClip(clips, candidate, excludeClipId)) return requested;

  const durationMs = clipDurationMs(candidate);
  const obstacles = clips.filter((clip) => clip.trackId === trackId && clip.id !== excludeClipId);
  const candidates = new Set<number>([0, requested, trackTimelineEndMs(obstacles, trackId)]);
  for (const obstacle of obstacles) {
    candidates.add(clipTimelineEndMs(obstacle));
    const before = obstacle.timelineStartMs - durationMs;
    if (before >= 0) candidates.add(before);
  }

  const legal = [...candidates]
    .filter(Number.isSafeInteger)
    .filter((timelineStartMs) =>
      canPlaceClip(clips, { ...candidate, timelineStartMs }, excludeClipId),
    )
    .sort(
      (left, right) => Math.abs(left - requested) - Math.abs(right - requested) || left - right,
    );
  const snapped = legal[0];
  if (snapped === undefined) {
    throw new DomainError('CLIP_COLLISION', 'No legal timeline position is available.');
  }
  return snapped;
}

export const buildCompositionTimeline = buildClipTimeline;
export const mapCompositionPositionToClip = mapCompositionPosition;
