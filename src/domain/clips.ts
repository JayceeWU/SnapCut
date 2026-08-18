import { MIN_CLIP_DURATION_MS } from './constants';
import { DomainError } from './errors';
import { snapCutProjectSchema } from './schemas';
import { clipDurationMs } from './timeline';
import type { SnapCutClip, SnapCutProject } from './types';

type ClipUpdate = Partial<Omit<SnapCutClip, 'id'>>;

function validateClipAgainstProject(clipInput: SnapCutClip, project: SnapCutProject): SnapCutClip {
  const source = project.sources.find(({ id }) => id === clipInput.sourceId);
  if (!source) {
    throw new DomainError('SOURCE_NOT_FOUND', `Clip source does not exist: ${clipInput.sourceId}`);
  }
  if (
    !Number.isSafeInteger(clipInput.startMs) ||
    !Number.isSafeInteger(clipInput.endMs) ||
    clipInput.startMs < 0 ||
    clipInput.endMs > source.durationMs ||
    clipDurationMs(clipInput) < MIN_CLIP_DURATION_MS
  ) {
    throw new DomainError(
      'INVALID_CLIP_RANGE',
      `Clip must fit the source and be at least ${MIN_CLIP_DURATION_MS} milliseconds.`,
    );
  }
  return clipInput;
}

function commitClips(
  project: SnapCutProject,
  clips: readonly SnapCutClip[],
  updatedAt: string,
): SnapCutProject {
  const adjacentBoundaries = new Set(
    clips.slice(0, -1).map((clip, index) => `${clip.id}:${clips[index + 1]!.id}`),
  );
  const crossfades = project.crossfades.filter((crossfade) =>
    adjacentBoundaries.has(`${crossfade.leftClipId}:${crossfade.rightClipId}`),
  );
  return snapCutProjectSchema.parse({ ...project, clips, crossfades, updatedAt });
}

export function addClip(
  projectInput: SnapCutProject,
  clipInput: SnapCutClip,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
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
  const project = projectInput;
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
  const project = projectInput;
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
  const project = projectInput;
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
