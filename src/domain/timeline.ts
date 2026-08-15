import { assertIntegerMilliseconds } from '@/utils/time';

import { DomainError } from './errors';
import { snapCutClipSchema } from './schemas';
import type { ClipTimelineEntry, SnapCutClip, TimelinePosition, TrackId } from './types';

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Composition duration exceeds safe integer range');
  }
  return result;
}

export function clipDurationMs(clip: SnapCutClip): number {
  const parsed = snapCutClipSchema.parse(clip);
  return parsed.endMs - parsed.startMs;
}

/** v7 has no persisted absolute position; this is the clip's own duration. */
export function clipTimelineEndMs(clip: SnapCutClip): number {
  return clipDurationMs(clip);
}

export function compositionDurationMs(clips: readonly SnapCutClip[]): number {
  return clips.reduce((total, clip) => checkedAdd(total, clipDurationMs(clip)), 0);
}

export function buildClipTimeline(clips: readonly SnapCutClip[]): ClipTimelineEntry[] {
  const ids = new Set<string>();
  let cursorMs = 0;
  return clips.map((clip) => {
    const parsed = snapCutClipSchema.parse(clip) as SnapCutClip;
    if (ids.has(parsed.id)) {
      throw new DomainError('DUPLICATE_ID', `Duplicate clip ID: ${parsed.id}`);
    }
    ids.add(parsed.id);
    const compositionStartMs = cursorMs;
    cursorMs = checkedAdd(cursorMs, clipDurationMs(parsed));
    return {
      clipId: parsed.id,
      compositionStartMs,
      compositionEndMs: cursorMs,
    };
  });
}

export function mapCompositionPosition(
  clips: readonly SnapCutClip[],
  compositionPositionMs: number,
): TimelinePosition | null {
  const positionMs = assertIntegerMilliseconds(compositionPositionMs, 'compositionPositionMs');
  const timeline = buildClipTimeline(clips);
  const entry = timeline.find(
    (candidate) =>
      positionMs >= candidate.compositionStartMs && positionMs < candidate.compositionEndMs,
  );
  if (!entry) return null;
  const clipIndex = clips.findIndex(({ id }) => id === entry.clipId);
  const clip = clips[clipIndex]!;
  const positionInClipMs = positionMs - entry.compositionStartMs;
  return {
    clipId: entry.clipId,
    clipIndex,
    positionInClipMs,
    sourcePositionMs: clip.startMs + positionInClipMs,
    compositionPositionMs: positionMs,
  };
}

export function mapTimelinePositionToClips(
  clips: readonly SnapCutClip[],
  compositionPositionMs: number,
): TimelinePosition[] {
  const result = mapCompositionPosition(clips, compositionPositionMs);
  return result === null ? [] : [result];
}

// Compatibility helpers for private native adapters while v7 callers migrate.
export function trackTimelineEndMs(
  clips: readonly SnapCutClip[],
  _trackId: TrackId,
  excludeClipId?: string,
): number {
  return compositionDurationMs(clips.filter(({ id }) => id !== excludeClipId));
}

export function findClipCollisionIds(): string[] {
  return [];
}

export function canPlaceClip(): boolean {
  return true;
}

export function snapClipTimelineStartMs(
  _clips: readonly SnapCutClip[],
  _candidate: SnapCutClip,
  requestedTimelineStartMs: number,
): number {
  return assertIntegerMilliseconds(requestedTimelineStartMs, 'requestedTimelineStartMs');
}

export const buildCompositionTimeline = buildClipTimeline;
export const mapCompositionPositionToClip = mapCompositionPosition;
