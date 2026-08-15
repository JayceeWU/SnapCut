import { assertIntegerMilliseconds } from '@/utils/time';

import { FADE_DURATION_VALUES_MS, MIN_CLIP_DURATION_MS } from './constants';
import { DomainError } from './errors';
import { snapCutClipSchema, snapCutProjectSchema } from './schemas';
import {
  clipDurationMs,
  clipTimelineEndMs,
  findClipCollisionIds,
  snapClipTimelineStartMs,
  trackTimelineEndMs,
} from './timeline';
import type { FadeDurationMs, SnapCutClip, SnapCutProject, TrackId } from './types';

export type ClipUpdate = Partial<Omit<SnapCutClip, 'id'>>;
export type ClipTrimEdge = 'left' | 'right';

export interface ClipRangeUpdate extends ClipUpdate {
  sourceId: string;
  startMs: number;
  endMs: number;
}

function parseClip(clipInput: SnapCutClip): SnapCutClip {
  const parsed = snapCutClipSchema.safeParse(clipInput);
  if (!parsed.success) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Clip settings are invalid.');
  }
  return parsed.data as SnapCutClip;
}

function validateClipAgainstProject(
  clipInput: SnapCutClip,
  project: SnapCutProject,
  excludeClipId?: string,
): SnapCutClip {
  const clip = parseClip(clipInput);
  const source = project.sources.find(({ id }) => id === clip.sourceId);
  if (!source) {
    throw new DomainError('SOURCE_NOT_FOUND', `Clip source does not exist: ${clip.sourceId}`);
  }
  if (clip.endMs > source.durationMs) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Clip end cannot exceed source duration');
  }
  if (clip.endMs - clip.startMs < MIN_CLIP_DURATION_MS) {
    throw new DomainError(
      'INVALID_CLIP_RANGE',
      `Clip duration must be at least ${MIN_CLIP_DURATION_MS} milliseconds`,
    );
  }
  if (findClipCollisionIds(project.clips, clip, excludeClipId).length > 0) {
    throw new DomainError('CLIP_COLLISION', 'Clips on the same track cannot overlap.');
  }
  return clip;
}

function commitProject(
  project: SnapCutProject,
  patch: Partial<Pick<SnapCutProject, 'clips' | 'trackCount'>>,
  updatedAt: string,
): SnapCutProject {
  return snapCutProjectSchema.parse({ ...project, ...patch, updatedAt }) as SnapCutProject;
}

export function validateClipRange(
  clip: SnapCutClip,
  sources: readonly SnapCutProject['sources'][number][],
): SnapCutClip {
  const parsed = parseClip(clip);
  const source = sources.find(({ id }) => id === parsed.sourceId);
  if (!source) {
    throw new DomainError('SOURCE_NOT_FOUND', `Clip source does not exist: ${parsed.sourceId}`);
  }
  if (parsed.endMs > source.durationMs) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Clip end cannot exceed source duration');
  }
  if (clipDurationMs(parsed) < MIN_CLIP_DURATION_MS) {
    throw new DomainError(
      'INVALID_CLIP_RANGE',
      `Clip duration must be at least ${MIN_CLIP_DURATION_MS} milliseconds`,
    );
  }
  return parsed;
}

export function addClip(
  projectInput: SnapCutProject,
  clipInput: SnapCutClip,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  if (project.clips.some(({ id }) => id === clipInput.id)) {
    throw new DomainError('DUPLICATE_ID', `Clip ID already exists: ${clipInput.id}`);
  }
  const clip = validateClipAgainstProject(clipInput, project);
  return commitProject(project, { clips: [...project.clips, clip] }, updatedAt);
}

export function updateClip(
  projectInput: SnapCutProject,
  clipId: string,
  update: ClipUpdate,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) {
    throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  }
  const existing = project.clips[index]!;
  const replacement = validateClipAgainstProject(
    { ...existing, ...update, id: clipId },
    project,
    clipId,
  );
  const clips = project.clips.slice();
  clips[index] = replacement;
  return commitProject(project, { clips }, updatedAt);
}

export function deleteClip(
  projectInput: SnapCutProject,
  clipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  if (!project.clips.some(({ id }) => id === clipId)) {
    throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  }
  return commitProject(
    project,
    { clips: project.clips.filter(({ id }) => id !== clipId) },
    updatedAt,
  );
}

export function placeClip(
  projectInput: SnapCutProject,
  clipId: string,
  requestedTimelineStartMs: number,
  trackId?: TrackId,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const clip = project.clips.find(({ id }) => id === clipId);
  if (!clip) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  const destinationTrackId = trackId ?? clip.trackId;
  const timelineStartMs = snapClipTimelineStartMs(
    project.clips,
    clip,
    requestedTimelineStartMs,
    destinationTrackId,
    clipId,
  );
  return updateClip(project, clipId, { trackId: destinationTrackId, timelineStartMs }, updatedAt);
}

export function moveClipToStart(
  project: SnapCutProject,
  clipId: string,
  trackId?: TrackId,
  updatedAt = project.updatedAt,
): SnapCutProject {
  return placeClip(project, clipId, 0, trackId, updatedAt);
}

export function moveClipToEnd(
  projectInput: SnapCutProject,
  clipId: string,
  trackId?: TrackId,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const clip = project.clips.find(({ id }) => id === clipId);
  if (!clip) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  const destinationTrackId = trackId ?? clip.trackId;
  return placeClip(
    project,
    clipId,
    trackTimelineEndMs(project.clips, destinationTrackId, clipId),
    destinationTrackId,
    updatedAt,
  );
}

export function duplicateClip(
  projectInput: SnapCutProject,
  clipId: string,
  newClipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const original = project.clips.find(({ id }) => id === clipId);
  if (!original) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  if (project.clips.some(({ id }) => id === newClipId)) {
    throw new DomainError('DUPLICATE_ID', `Clip ID already exists: ${newClipId}`);
  }
  const candidate = { ...original, id: newClipId, timelineStartMs: clipTimelineEndMs(original) };
  const timelineStartMs = snapClipTimelineStartMs(
    project.clips,
    candidate,
    candidate.timelineStartMs,
    candidate.trackId,
    undefined,
  );
  const duplicate = validateClipAgainstProject({ ...candidate, timelineStartMs }, project);
  const originalIndex = project.clips.findIndex(({ id }) => id === clipId);
  const clips = project.clips.slice();
  clips.splice(originalIndex + 1, 0, duplicate);
  return commitProject(project, { clips }, updatedAt);
}

/** Returns the largest valid 500 ms fade that does not exceed either input. */
export function fitFadeDurationMs(fadeMs: number, durationMs: number): FadeDurationMs {
  return (
    [...FADE_DURATION_VALUES_MS]
      .reverse()
      .find((value) => value <= fadeMs && value <= durationMs) ?? 0
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function fitTrimmedFades(
  clip: SnapCutClip,
  durationMs: number,
  edge: ClipTrimEdge,
): Pick<SnapCutClip, 'fadeInMs' | 'fadeOutMs'> {
  let fadeInMs = clip.fadeInMs;
  let fadeOutMs = clip.fadeOutMs;
  if (fadeInMs + fadeOutMs <= durationMs) return { fadeInMs, fadeOutMs };

  if (edge === 'left') {
    fadeInMs = fitFadeDurationMs(fadeInMs, Math.max(0, durationMs - fadeOutMs));
    if (fadeInMs + fadeOutMs > durationMs) {
      fadeOutMs = fitFadeDurationMs(fadeOutMs, durationMs - fadeInMs);
    }
  } else {
    fadeOutMs = fitFadeDurationMs(fadeOutMs, Math.max(0, durationMs - fadeInMs));
    if (fadeInMs + fadeOutMs > durationMs) {
      fadeInMs = fitFadeDurationMs(fadeInMs, durationMs - fadeOutMs);
    }
  }

  return { fadeInMs, fadeOutMs };
}

/**
 * Trims one source edge without moving the opposite timeline edge or rippling
 * any neighbor. A drag request is clamped to source, duration, timeline, and
 * same-track gap bounds; clips on the other track do not constrain the trim.
 */
export function trimClipEdge(
  projectInput: SnapCutProject,
  clipId: string,
  edge: ClipTrimEdge,
  requestedSourceMs: number,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const clip = project.clips.find(({ id }) => id === clipId);
  if (!clip) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  if (edge !== 'left' && edge !== 'right') {
    throw new DomainError('INVALID_CLIP_RANGE', `Unknown clip edge: ${String(edge)}`);
  }
  if (!Number.isSafeInteger(requestedSourceMs)) {
    throw new DomainError(
      'INVALID_TIMESTAMP',
      'requestedSourceMs must be an integer number of milliseconds',
    );
  }

  const source = project.sources.find(({ id }) => id === clip.sourceId)!;
  const timelineEndMs = clipTimelineEndMs(clip);
  const sameTrackNeighbors = project.clips.filter(
    (candidate) => candidate.id !== clip.id && candidate.trackId === clip.trackId,
  );

  if (edge === 'left') {
    const previousTimelineEndMs = sameTrackNeighbors.reduce(
      (latest, candidate) =>
        clipTimelineEndMs(candidate) <= clip.timelineStartMs
          ? Math.max(latest, clipTimelineEndMs(candidate))
          : latest,
      0,
    );
    const minimumStartMs = Math.max(
      0,
      clip.startMs - clip.timelineStartMs,
      clip.startMs + previousTimelineEndMs - clip.timelineStartMs,
    );
    const startMs = clamp(requestedSourceMs, minimumStartMs, clip.endMs - MIN_CLIP_DURATION_MS);
    const durationMs = clip.endMs - startMs;
    return updateClip(
      project,
      clipId,
      {
        startMs,
        timelineStartMs: timelineEndMs - durationMs,
        ...fitTrimmedFades(clip, durationMs, edge),
      },
      updatedAt,
    );
  }

  const nextTimelineStartMs = sameTrackNeighbors.reduce(
    (earliest, candidate) =>
      candidate.timelineStartMs >= timelineEndMs
        ? Math.min(earliest, candidate.timelineStartMs)
        : earliest,
    Number.POSITIVE_INFINITY,
  );
  const maximumEndMs = Math.min(
    source.durationMs,
    Number.isFinite(nextTimelineStartMs)
      ? clip.startMs + nextTimelineStartMs - clip.timelineStartMs
      : source.durationMs,
  );
  const endMs = clamp(requestedSourceMs, clip.startMs + MIN_CLIP_DURATION_MS, maximumEndMs);
  const durationMs = endMs - clip.startMs;
  return updateClip(
    project,
    clipId,
    { endMs, ...fitTrimmedFades(clip, durationMs, edge) },
    updatedAt,
  );
}

export function splitClip(
  projectInput: SnapCutProject,
  clipId: string,
  sourceSplitMsInput: number,
  newClipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  if (project.clips.some(({ id }) => id === newClipId)) {
    throw new DomainError('DUPLICATE_ID', `Clip ID already exists: ${newClipId}`);
  }
  const original = project.clips[index]!;
  const sourceSplitMs = assertIntegerMilliseconds(sourceSplitMsInput, 'sourceSplitMs');
  if (
    sourceSplitMs - original.startMs < MIN_CLIP_DURATION_MS ||
    original.endMs - sourceSplitMs < MIN_CLIP_DURATION_MS
  ) {
    throw new DomainError(
      'INVALID_CLIP_RANGE',
      `Each split clip must be at least ${MIN_CLIP_DURATION_MS} milliseconds.`,
    );
  }
  const leftDurationMs = sourceSplitMs - original.startMs;
  const rightDurationMs = original.endMs - sourceSplitMs;
  const left: SnapCutClip = {
    ...original,
    endMs: sourceSplitMs,
    fadeInMs: fitFadeDurationMs(original.fadeInMs, leftDurationMs),
    fadeOutMs: 0,
  };
  const right: SnapCutClip = {
    ...original,
    id: newClipId,
    startMs: sourceSplitMs,
    timelineStartMs: original.timelineStartMs + leftDurationMs,
    fadeInMs: 0,
    fadeOutMs: fitFadeDurationMs(original.fadeOutMs, rightDurationMs),
  };
  const clips = project.clips.slice();
  clips.splice(index, 1, left, right);
  return commitProject(project, { clips }, updatedAt);
}

export function addFullSourceClip(
  projectInput: SnapCutProject,
  sourceId: string,
  clipId: string,
  trackId: TrackId = 'track-1',
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const source = project.sources.find(({ id }) => id === sourceId);
  if (!source) throw new DomainError('SOURCE_NOT_FOUND', `Source does not exist: ${sourceId}`);
  return addClip(
    project,
    {
      id: clipId,
      sourceId,
      startMs: 0,
      endMs: source.durationMs,
      trackId,
      timelineStartMs: trackTimelineEndMs(project.clips, trackId),
      gain: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
    },
    updatedAt,
  );
}

export function moveClipEarlier(
  projectInput: SnapCutProject,
  clipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const clip = project.clips.find(({ id }) => id === clipId);
  if (!clip) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  const moved = placeClip(
    project,
    clipId,
    Math.max(0, clip.timelineStartMs - clipDurationMs(clip)),
    clip.trackId,
    updatedAt,
  );
  if (moved.clips.find(({ id }) => id === clipId)?.timelineStartMs === clip.timelineStartMs) {
    throw new DomainError('MOVE_OUT_OF_BOUNDS', 'Clip cannot move earlier.');
  }
  return moved;
}

export function moveClipLater(
  projectInput: SnapCutProject,
  clipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const clip = project.clips.find(({ id }) => id === clipId);
  if (!clip) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  return placeClip(project, clipId, clipTimelineEndMs(clip), clip.trackId, updatedAt);
}
