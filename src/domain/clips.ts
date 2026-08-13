import { MIN_CLIP_DURATION_MS } from './constants';
import { DomainError } from './errors';
import { snapCutClipSchema, snapCutProjectSchema } from './schemas';
import type { SnapCutClip, SnapCutProject, SnapCutSource } from './types';

export interface ClipRangeUpdate {
  sourceId: string;
  startMs: number;
  endMs: number;
}

function validateClipAgainstSources(
  clipInput: SnapCutClip,
  sources: readonly SnapCutSource[],
): SnapCutClip {
  const clip = snapCutClipSchema.parse(clipInput) as SnapCutClip;
  const source = sources.find(({ id }) => id === clip.sourceId);
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
  return clip;
}

function commitClips(
  project: SnapCutProject,
  clips: SnapCutClip[],
  updatedAt: string,
): SnapCutProject {
  return snapCutProjectSchema.parse({ ...project, clips, updatedAt }) as SnapCutProject;
}

export function validateClipRange(
  clip: SnapCutClip,
  sources: readonly SnapCutSource[],
): SnapCutClip {
  return validateClipAgainstSources(clip, sources);
}

export function addClip(
  projectInput: SnapCutProject,
  clipInput: SnapCutClip,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const clip = validateClipAgainstSources(clipInput, project.sources);
  if (project.clips.some(({ id }) => id === clip.id)) {
    throw new DomainError('DUPLICATE_ID', `Clip ID already exists: ${clip.id}`);
  }
  return commitClips(project, [...project.clips, clip], updatedAt);
}

export function updateClip(
  projectInput: SnapCutProject,
  clipId: string,
  update: ClipRangeUpdate,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) {
    throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  }

  const replacement = validateClipAgainstSources({ id: clipId, ...update }, project.sources);
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
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) {
    throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  }

  return commitClips(
    project,
    project.clips.filter(({ id }) => id !== clipId),
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
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) {
    throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  }
  if (project.clips.some(({ id }) => id === newClipId)) {
    throw new DomainError('DUPLICATE_ID', `Clip ID already exists: ${newClipId}`);
  }

  const duplicate = validateClipAgainstSources(
    { ...project.clips[index]!, id: newClipId },
    project.sources,
  );
  const clips = project.clips.slice();
  clips.splice(index + 1, 0, duplicate);
  return commitClips(project, clips, updatedAt);
}

function moveClip(
  projectInput: SnapCutProject,
  clipId: string,
  offset: -1 | 1,
  updatedAt: string,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const index = project.clips.findIndex(({ id }) => id === clipId);
  if (index < 0) {
    throw new DomainError('CLIP_NOT_FOUND', `Clip does not exist: ${clipId}`);
  }
  const target = index + offset;
  if (target < 0 || target >= project.clips.length) {
    throw new DomainError('MOVE_OUT_OF_BOUNDS', 'Clip cannot move beyond the composition boundary');
  }

  const clips = project.clips.slice();
  [clips[index], clips[target]] = [clips[target]!, clips[index]!];
  return commitClips(project, clips, updatedAt);
}

export function moveClipEarlier(
  project: SnapCutProject,
  clipId: string,
  updatedAt = project.updatedAt,
): SnapCutProject {
  return moveClip(project, clipId, -1, updatedAt);
}

export function moveClipLater(
  project: SnapCutProject,
  clipId: string,
  updatedAt = project.updatedAt,
): SnapCutProject {
  return moveClip(project, clipId, 1, updatedAt);
}
