import type {
  FadeDurationMs,
  SnapCutClip,
  SnapCutProject,
  SnapCutSource,
  WaveformFileV1,
} from '@/domain/types';
import { FADE_DURATION_VALUES_MS } from '@/domain/constants';

export interface TimelineViewport {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface TimelineClipGeometry {
  left: number;
  width: number;
  visibleStartMs: number;
  visibleEndMs: number;
}

export interface TimelineFadeRegionGeometry {
  readonly left: number;
  readonly width: number;
  readonly handleX: number | null;
}

export interface TimelineFadeGeometry {
  readonly fadeIn: TimelineFadeRegionGeometry | null;
  readonly fadeOut: TimelineFadeRegionGeometry | null;
}

export type TimelineTrimEdge = 'left' | 'right';

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function projectTimelineDurationMs(clips: readonly SnapCutClip[]): number {
  return clips.reduce(
    (maximum, clip) =>
      Math.max(maximum, clip.timelineStartMs + Math.max(0, clip.endMs - clip.startMs)),
    0,
  );
}

export function projectContainsCommittedSourceClip(
  project: SnapCutProject | null,
  sourceId: string,
): boolean {
  return (
    project !== null &&
    project.sources.some(({ id }) => id === sourceId) &&
    project.clips.some((clip) => clip.sourceId === sourceId)
  );
}

/**
 * Describes the fixed-playhead viewport. The project may extend into virtual
 * leading or trailing space so both 0 and the project end can sit beneath the
 * centered cursor.
 */
export function getCenteredTimelineViewport(
  durationMs: number,
  visibleSpanMs: number,
  cursorMs: number,
): TimelineViewport {
  const duration = Math.max(0, Math.round(durationMs));
  const maximumSpan = duration > 0 ? duration : 30_000;
  const minimumSpan = duration > 0 ? Math.min(1_000, duration) : 1_000;
  const span = clamp(Math.round(visibleSpanMs), minimumSpan, maximumSpan);
  const cursor = clamp(Math.round(cursorMs), 0, duration);
  const startMs = cursor - span / 2;
  return { startMs, endMs: startMs + span, durationMs: span };
}

export function timelineXToTime(x: number, width: number, viewport: TimelineViewport): number {
  if (width <= 0) return Math.round(viewport.startMs);
  return Math.round(viewport.startMs + (clamp(x, 0, width) / width) * viewport.durationMs);
}

export function timelineClipGeometry(
  clip: SnapCutClip,
  viewport: TimelineViewport,
  width: number,
): TimelineClipGeometry | null {
  const clipStartMs = clip.timelineStartMs;
  const clipEndMs = clipStartMs + Math.max(0, clip.endMs - clip.startMs);
  const visibleStartMs = Math.max(clipStartMs, viewport.startMs);
  const visibleEndMs = Math.min(clipEndMs, viewport.endMs);
  if (visibleStartMs >= visibleEndMs || width <= 0) return null;
  return {
    left: ((visibleStartMs - viewport.startMs) / viewport.durationMs) * width,
    width: Math.max(2, ((visibleEndMs - visibleStartMs) / viewport.durationMs) * width),
    visibleStartMs,
    visibleEndMs,
  };
}

/** Produces the transient clip shown while an edge handle is dragged. */
export function timelineTrimDraft(
  clip: SnapCutClip,
  sourceDurationMs: number,
  edge: TimelineTrimEdge,
  requestedTimelineMs: number,
  minimumClipDurationMs = 100,
  clips: readonly SnapCutClip[] = [],
): SnapCutClip {
  const clipDurationMs = clip.endMs - clip.startMs;
  const timelineEndMs = clip.timelineStartMs + clipDurationMs;
  const sameTrackNeighbors = clips.filter(
    (candidate) => candidate.id !== clip.id && candidate.trackId === clip.trackId,
  );
  const fitFade = (fadeMs: FadeDurationMs, availableMs: number): FadeDurationMs =>
    ([...FADE_DURATION_VALUES_MS] as FadeDurationMs[])
      .reverse()
      .find((preset) => preset <= fadeMs && preset <= availableMs) ?? 0;
  const fitFades = (durationMs: number): Pick<SnapCutClip, 'fadeInMs' | 'fadeOutMs'> => {
    let fadeInMs = clip.fadeInMs;
    let fadeOutMs = clip.fadeOutMs;
    if (fadeInMs + fadeOutMs <= durationMs) return { fadeInMs, fadeOutMs };
    if (edge === 'left') {
      fadeInMs = fitFade(fadeInMs, Math.max(0, durationMs - fadeOutMs));
      if (fadeInMs + fadeOutMs > durationMs) {
        fadeOutMs = fitFade(fadeOutMs, durationMs - fadeInMs);
      }
    } else {
      fadeOutMs = fitFade(fadeOutMs, Math.max(0, durationMs - fadeInMs));
      if (fadeInMs + fadeOutMs > durationMs) {
        fadeInMs = fitFade(fadeInMs, durationMs - fadeOutMs);
      }
    }
    return { fadeInMs, fadeOutMs };
  };
  if (edge === 'left') {
    const previousTimelineEndMs = sameTrackNeighbors.reduce((latest, candidate) => {
      const candidateEndMs = candidate.timelineStartMs + candidate.endMs - candidate.startMs;
      return candidateEndMs <= clip.timelineStartMs ? Math.max(latest, candidateEndMs) : latest;
    }, 0);
    const minimumStartMs = Math.max(
      0,
      clip.startMs - clip.timelineStartMs,
      clip.startMs + previousTimelineEndMs - clip.timelineStartMs,
    );
    const requestedSourceMs = clip.startMs + requestedTimelineMs - clip.timelineStartMs;
    const startMs = clamp(
      Math.round(requestedSourceMs),
      minimumStartMs,
      clip.endMs - minimumClipDurationMs,
    );
    const durationMs = clip.endMs - startMs;
    return {
      ...clip,
      startMs,
      timelineStartMs: timelineEndMs - durationMs,
      ...fitFades(durationMs),
    };
  }

  const requestedSourceMs = clip.endMs + (requestedTimelineMs - timelineEndMs);
  const nextTimelineStartMs = sameTrackNeighbors.reduce(
    (earliest, candidate) =>
      candidate.timelineStartMs >= timelineEndMs
        ? Math.min(earliest, candidate.timelineStartMs)
        : earliest,
    Number.POSITIVE_INFINITY,
  );
  const maximumEndMs = Math.min(
    Math.round(sourceDurationMs),
    Number.isFinite(nextTimelineStartMs)
      ? clip.endMs + nextTimelineStartMs - timelineEndMs
      : Math.round(sourceDurationMs),
  );
  const endMs = clamp(
    Math.round(requestedSourceMs),
    clip.startMs + minimumClipDurationMs,
    Math.max(clip.startMs + minimumClipDurationMs, maximumEndMs),
  );
  return {
    ...clip,
    endMs,
    ...fitFades(endMs - clip.startMs),
  };
}

export function canSplitClipAtTimelinePosition(
  clip: SnapCutClip,
  timelinePositionMs: number,
  minimumSideMs = 100,
): boolean {
  const relativeMs = timelinePositionMs - clip.timelineStartMs;
  const durationMs = clip.endMs - clip.startMs;
  return relativeMs >= minimumSideMs && durationMs - relativeMs >= minimumSideMs;
}

export function timelineFadeGeometry(
  clip: SnapCutClip,
  visibleTimelineStartMs: number,
  visibleTimelineEndMs: number,
  width: number,
): TimelineFadeGeometry {
  const clipDurationMs = Math.max(0, clip.endMs - clip.startMs);
  const visibleStartInClipMs = clamp(
    visibleTimelineStartMs - clip.timelineStartMs,
    0,
    clipDurationMs,
  );
  const visibleEndInClipMs = clamp(
    visibleTimelineEndMs - clip.timelineStartMs,
    visibleStartInClipMs,
    clipDurationMs,
  );
  const visibleDurationMs = visibleEndInClipMs - visibleStartInClipMs;
  if (width <= 0 || visibleDurationMs <= 0) return { fadeIn: null, fadeOut: null };

  const scale = width / visibleDurationMs;
  const region = (
    regionStartMs: number,
    regionEndMs: number,
    handleMs: number,
  ): TimelineFadeRegionGeometry | null => {
    const startMs = Math.max(regionStartMs, visibleStartInClipMs);
    const endMs = Math.min(regionEndMs, visibleEndInClipMs);
    if (startMs >= endMs) return null;
    return {
      left: (startMs - visibleStartInClipMs) * scale,
      width: (endMs - startMs) * scale,
      handleX:
        handleMs >= visibleStartInClipMs && handleMs <= visibleEndInClipMs
          ? clamp((handleMs - visibleStartInClipMs) * scale, 0, width)
          : null,
    };
  };

  return {
    fadeIn: clip.fadeInMs > 0 ? region(0, clip.fadeInMs, clip.fadeInMs) : null,
    fadeOut:
      clip.fadeOutMs > 0
        ? region(clipDurationMs - clip.fadeOutMs, clipDurationMs, clipDurationMs - clip.fadeOutMs)
        : null,
  };
}

export function visualFadeEnvelope(clip: SnapCutClip, positionInClipMs: number): number {
  const clipDurationMs = Math.max(0, clip.endMs - clip.startMs);
  const position = clamp(positionInClipMs, 0, clipDurationMs);
  let envelope = 1;
  if (clip.fadeInMs > 0 && position < clip.fadeInMs) {
    envelope = Math.min(envelope, Math.sin((Math.PI / 2) * (position / clip.fadeInMs)));
  }
  const remainingMs = clipDurationMs - position;
  if (clip.fadeOutMs > 0 && remainingMs < clip.fadeOutMs) {
    envelope = Math.min(envelope, Math.cos((Math.PI / 2) * (1 - remainingMs / clip.fadeOutMs)));
  }
  return clamp(envelope * clip.gain, 0, 1);
}

export function sampleTimelineClipWaveform(
  clip: SnapCutClip,
  source: SnapCutSource,
  waveform: WaveformFileV1 | null | undefined,
  pointCount: number,
  visibleTimelineStartMs = clip.timelineStartMs,
  visibleTimelineEndMs = clip.timelineStartMs + (clip.endMs - clip.startMs),
): number[] {
  const points = Math.max(2, Math.round(pointCount));
  const sourceRangeMs = Math.max(1, clip.endMs - clip.startMs);
  const visibleStartInClipMs = clamp(
    visibleTimelineStartMs - clip.timelineStartMs,
    0,
    sourceRangeMs,
  );
  const visibleEndInClipMs = clamp(
    visibleTimelineEndMs - clip.timelineStartMs,
    visibleStartInClipMs,
    sourceRangeMs,
  );
  const visibleDurationMs = Math.max(1, visibleEndInClipMs - visibleStartInClipMs);
  return Array.from({ length: points }, (_, index) => {
    const progress = index / Math.max(1, points - 1);
    const positionInClipMs = visibleStartInClipMs + visibleDurationMs * progress;
    if (!waveform || waveform.rms.length === 0 || source.durationMs <= 0) {
      return 0.08 * visualFadeEnvelope(clip, positionInClipMs);
    }
    const sourceTimeMs = clip.startMs + positionInClipMs;
    const binIndex = clamp(
      Math.floor((sourceTimeMs / source.durationMs) * waveform.rms.length),
      0,
      waveform.rms.length - 1,
    );
    const amplitude = waveform.rms[binIndex] ?? 0;
    return clamp(amplitude * visualFadeEnvelope(clip, positionInClipMs), 0, 1);
  });
}
