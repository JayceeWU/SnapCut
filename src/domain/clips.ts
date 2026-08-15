import { assertIntegerMilliseconds } from '@/utils/time';

import { FADE_DURATION_VALUES_MS, MIN_CLIP_DURATION_MS } from './constants';
import { DomainError } from './errors';
import { snapCutClipSchema, snapCutProjectSchema } from './schemas';
import { clipDurationMs } from './timeline';
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

function validateClipAgainstProject(clipInput: SnapCutClip, project: SnapCutProject): SnapCutClip {
  const clip = parseClip(clipInput);
  const source = project.sources.find(({ id }) => id === clip.sourceId);
  if (!source) {
    throw new DomainError('SOURCE_NOT_FOUND', `Clip source does not exist: ${clip.sourceId}`);
  }
  if (clip.endMs > source.durationMs) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Clip end cannot exceed source duration');
  }
  if (clipDurationMs(clip) < MIN_CLIP_DURATION_MS) {
    throw new DomainError(
      'INVALID_CLIP_RANGE',
      `Clip duration must be at least ${MIN_CLIP_DURATION_MS} milliseconds`,
    );
  }
  return clip;
}

function commitClips(
  project: SnapCutProject,
  clips: readonly SnapCutClip[],
  updatedAt: string,
): SnapCutProject {
  return snapCutProjectSchema.parse({ ...project, clips, updatedAt }) as SnapCutProject;
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
  if (parsed.endMs > source.durationMs || clipDurationMs(parsed) < MIN_CLIP_DURATION_MS) {
    throw new DomainError(
      'INVALID_CLIP_RANGE',
      `Clip must fit the source and be at least ${MIN_CLIP_DURATION_MS} milliseconds.`,
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
  return commitClips(
    project,
    [...project.clips, validateClipAgainstProject(clipInput, project)],
    updatedAt,
  );
}

export function updateClip(
  projectInput: SnapCutProject,
  clipId: string,
  update: ClipUpdate,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  const replacement = validateClipAgainstProject(
    { ...project.clips[index]!, ...update, id: clipId },
    project,
  );
  const clips = project.clips.slice();
  clips[index] = replacement;
  return commitClips(project, clips, updatedAt);
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
  return commitClips(
    project,
    project.clips.filter(({ id }) => id !== clipId),
    updatedAt,
  );
}

/** Moves a clip to an exact zero-based array position. */
export function reorderClip(
  projectInput: SnapCutProject,
  clipId: string,
  destinationIndex: number,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const sourceIndex = project.clips.findIndex(({ id }) => id === clipId);
  if (sourceIndex < 0) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  if (
    !Number.isSafeInteger(destinationIndex) ||
    destinationIndex < 0 ||
    destinationIndex >= project.clips.length
  ) {
    throw new DomainError('MOVE_OUT_OF_BOUNDS', 'Clip destination is outside the composition.');
  }
  if (sourceIndex === destinationIndex) return project;
  const clips = project.clips.slice();
  const [clip] = clips.splice(sourceIndex, 1);
  clips.splice(destinationIndex, 0, clip!);
  return commitClips(project, clips, updatedAt);
}

export function moveClipEarlier(
  projectInput: SnapCutProject,
  clipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  if (index === 0) throw new DomainError('MOVE_OUT_OF_BOUNDS', 'Clip is already first.');
  return reorderClip(project, clipId, index - 1, updatedAt);
}

export function moveClipLater(
  projectInput: SnapCutProject,
  clipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  if (index === project.clips.length - 1) {
    throw new DomainError('MOVE_OUT_OF_BOUNDS', 'Clip is already last.');
  }
  return reorderClip(project, clipId, index + 1, updatedAt);
}

export function duplicateClip(
  projectInput: SnapCutProject,
  clipId: string,
  newClipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  if (project.clips.some(({ id }) => id === newClipId)) {
    throw new DomainError('DUPLICATE_ID', `Clip ID already exists: ${newClipId}`);
  }
  const clips = project.clips.slice();
  clips.splice(index + 1, 0, { ...project.clips[index]!, id: newClipId });
  return commitClips(project, clips, updatedAt);
}

export function trimClipEdge(
  project: SnapCutProject,
  clipId: string,
  edge: ClipTrimEdge,
  requestedSourceMs: number,
  updatedAt = project.updatedAt,
): SnapCutProject {
  const requested = assertIntegerMilliseconds(requestedSourceMs, 'requestedSourceMs');
  const clip = project.clips.find(({ id }) => id === clipId);
  if (!clip) throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  return edge === 'left'
    ? updateClip(project, clipId, { startMs: requested }, updatedAt)
    : updateClip(project, clipId, { endMs: requested }, updatedAt);
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
  const splitMs = assertIntegerMilliseconds(sourceSplitMsInput, 'sourceSplitMs');
  if (
    splitMs - original.startMs < MIN_CLIP_DURATION_MS ||
    original.endMs - splitMs < MIN_CLIP_DURATION_MS
  ) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Both split ranges must be at least 100 ms.');
  }
  const clips = project.clips.slice();
  clips.splice(
    index,
    1,
    { ...original, endMs: splitMs },
    { ...original, id: newClipId, startMs: splitMs },
  );
  return commitClips(project, clips, updatedAt);
}

export function addFullSourceClip(
  projectInput: SnapCutProject,
  sourceId: string,
  clipId: string,
  legacyTrackOrUpdatedAt?: TrackId | string,
  explicitUpdatedAt?: string,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const source = project.sources.find(({ id }) => id === sourceId);
  if (!source) throw new DomainError('SOURCE_NOT_FOUND', `Source does not exist: ${sourceId}`);
  const updatedAt =
    explicitUpdatedAt ??
    (legacyTrackOrUpdatedAt !== 'track-1' && legacyTrackOrUpdatedAt !== 'track-2'
      ? legacyTrackOrUpdatedAt
      : undefined) ??
    project.updatedAt;
  return addClip(
    project,
    { id: clipId, sourceId, startMs: 0, endMs: source.durationMs },
    updatedAt,
  );
}

/** Kept for callers that still use the old helper name; v7 simply reorders. */
export function moveClipToStart(
  project: SnapCutProject,
  clipId: string,
  _trackId?: TrackId,
  updatedAt = project.updatedAt,
): SnapCutProject {
  return reorderClip(project, clipId, 0, updatedAt);
}

/** Kept for callers that still use the old helper name; v7 simply reorders. */
export function moveClipToEnd(
  project: SnapCutProject,
  clipId: string,
  _trackId?: TrackId,
  updatedAt = project.updatedAt,
): SnapCutProject {
  return reorderClip(project, clipId, project.clips.length - 1, updatedAt);
}

/** Timeline placement no longer exists; use array reordering in v7. */
export function placeClip(
  project: SnapCutProject,
  clipId: string,
  destinationIndex: number,
  _trackId?: TrackId,
  updatedAt = project.updatedAt,
): SnapCutProject {
  return reorderClip(project, clipId, destinationIndex, updatedAt);
}

/** Legacy pure helper retained for native compatibility; v7 does not persist fades. */
export function fitFadeDurationMs(fadeMs: number, durationMs: number): FadeDurationMs {
  return (
    [...FADE_DURATION_VALUES_MS]
      .reverse()
      .find((value) => value <= fadeMs && value <= durationMs) ?? 0
  );
}
