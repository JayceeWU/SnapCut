import { assertIntegerMilliseconds } from '@/utils/time';

import { DomainError } from './errors';
import type { ClipTimelineEntry, SnapCutClip, TimelinePosition } from './types';

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Composition duration exceeds safe integer range');
  }
  return result;
}

export function clipDurationMs(clip: SnapCutClip): number {
  return clip.endMs - clip.startMs;
}

export function compositionDurationMs(clips: readonly SnapCutClip[]): number {
  return clips.reduce((total, clip) => checkedAdd(total, clipDurationMs(clip)), 0);
}

export function buildClipTimeline(clips: readonly SnapCutClip[]): ClipTimelineEntry[] {
  let cursorMs = 0;
  return clips.map((clip) => {
    const compositionStartMs = cursorMs;
    cursorMs = checkedAdd(cursorMs, clipDurationMs(clip));
    return {
      clipId: clip.id,
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
