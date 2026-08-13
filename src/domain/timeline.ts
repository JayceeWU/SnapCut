import { DomainError } from './errors';
import { snapCutClipSchema } from './schemas';
import type { ClipTimelineEntry, SnapCutClip, TimelinePosition } from './types';
import { assertIntegerMilliseconds } from '../utils/time';

export function clipDurationMs(clip: SnapCutClip): number {
  const parsed = snapCutClipSchema.parse(clip);
  return parsed.endMs - parsed.startMs;
}

export function compositionDurationMs(clips: readonly SnapCutClip[]): number {
  let durationMs = 0;
  for (const clip of clips) {
    durationMs += clipDurationMs(clip);
    if (!Number.isSafeInteger(durationMs)) {
      throw new DomainError(
        'INVALID_CLIP_RANGE',
        'Composition duration exceeds safe integer range',
      );
    }
  }
  return durationMs;
}

export function buildClipTimeline(clips: readonly SnapCutClip[]): ClipTimelineEntry[] {
  let compositionStartMs = 0;
  const ids = new Set<string>();

  return clips.map((clip) => {
    const parsed = snapCutClipSchema.parse(clip);
    if (ids.has(parsed.id)) {
      throw new DomainError('DUPLICATE_ID', `Duplicate clip ID: ${parsed.id}`);
    }
    ids.add(parsed.id);

    const compositionEndMs = compositionStartMs + clipDurationMs(parsed);
    if (!Number.isSafeInteger(compositionEndMs)) {
      throw new DomainError(
        'INVALID_CLIP_RANGE',
        'Composition timeline exceeds safe integer range',
      );
    }

    const entry: ClipTimelineEntry = {
      clipId: parsed.id,
      compositionStartMs,
      compositionEndMs,
    };
    compositionStartMs = compositionEndMs;
    return entry;
  });
}

export function mapCompositionPosition(
  clips: readonly SnapCutClip[],
  compositionPositionMs: number,
): TimelinePosition | null {
  const positionMs = assertIntegerMilliseconds(compositionPositionMs, 'compositionPositionMs');
  const timeline = buildClipTimeline(clips);
  if (timeline.length === 0 || positionMs >= timeline[timeline.length - 1]!.compositionEndMs) {
    return null;
  }

  let low = 0;
  let high = timeline.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const entry = timeline[middle]!;
    if (positionMs < entry.compositionStartMs) {
      high = middle - 1;
    } else if (positionMs >= entry.compositionEndMs) {
      low = middle + 1;
    } else {
      const clip = clips[middle]!;
      const positionInClipMs = positionMs - entry.compositionStartMs;
      return {
        clipId: entry.clipId,
        clipIndex: middle,
        positionInClipMs,
        sourcePositionMs: clip.startMs + positionInClipMs,
        compositionPositionMs: positionMs,
      };
    }
  }

  return null;
}

export const buildCompositionTimeline = buildClipTimeline;
export const mapCompositionPositionToClip = mapCompositionPosition;
