import { CROSSFADE_DURATION_VALUES_MS } from './constants';
import { DomainError } from './errors';
import { snapCutProjectSchema } from './schemas';
import type { CrossfadeDurationMs, SnapCutCrossfade, SnapCutProject, SnapCutSource } from './types';

interface CrossfadeBoundaryAvailability {
  leftClipId: string;
  rightClipId: string;
  durationsMs: CrossfadeDurationMs[];
}

function sourceById(project: SnapCutProject, sourceId: string): SnapCutSource {
  const source = project.sources.find(({ id }) => id === sourceId);
  if (!source) throw new DomainError('SOURCE_NOT_FOUND', `Source does not exist: ${sourceId}`);
  return source;
}

function crossfadeForBoundary(
  project: SnapCutProject,
  leftClipId: string,
  rightClipId: string,
  excludingId?: string,
): SnapCutCrossfade | undefined {
  return project.crossfades.find(
    (crossfade) =>
      crossfade.id !== excludingId &&
      crossfade.leftClipId === leftClipId &&
      crossfade.rightClipId === rightClipId,
  );
}

function crossfadeHalfForClip(
  project: SnapCutProject,
  clipId: string,
  side: 'incoming' | 'outgoing',
  excludingId?: string,
): number {
  const crossfade = project.crossfades.find(
    (candidate) =>
      candidate.id !== excludingId &&
      (side === 'incoming' ? candidate.rightClipId === clipId : candidate.leftClipId === clipId),
  );
  return crossfade ? crossfade.durationMs / 2 : 0;
}

export function availableCrossfadeDurations(
  projectInput: SnapCutProject,
  leftClipId: string,
  rightClipId: string,
  excludingId?: string,
): CrossfadeDurationMs[] {
  const project = projectInput;
  const leftIndex = project.clips.findIndex(({ id }) => id === leftClipId);
  if (leftIndex < 0 || project.clips[leftIndex + 1]?.id !== rightClipId) return [];
  if (crossfadeForBoundary(project, leftClipId, rightClipId, excludingId)) return [];
  const left = project.clips[leftIndex]!;
  const right = project.clips[leftIndex + 1]!;
  const leftSource = sourceById(project, left.sourceId);
  const incomingHalf = crossfadeHalfForClip(project, left.id, 'incoming', excludingId);
  const outgoingHalf = crossfadeHalfForClip(project, right.id, 'outgoing', excludingId);
  const leftDuration = left.endMs - left.startMs;
  const rightDuration = right.endMs - right.startMs;

  return CROSSFADE_DURATION_VALUES_MS.filter((durationMs) => {
    const half = durationMs / 2;
    return (
      leftSource.durationMs - left.endMs >= half &&
      right.startMs >= half &&
      leftDuration >= incomingHalf + half &&
      rightDuration >= half + outgoingHalf
    );
  });
}

export function firstAvailableCrossfadeBoundary(
  projectInput: SnapCutProject,
): CrossfadeBoundaryAvailability | null {
  const project = projectInput;
  for (let index = 0; index < project.clips.length - 1; index += 1) {
    const leftClipId = project.clips[index]!.id;
    const rightClipId = project.clips[index + 1]!.id;
    const durationsMs = availableCrossfadeDurations(project, leftClipId, rightClipId);
    if (durationsMs.length > 0) return { leftClipId, rightClipId, durationsMs };
  }
  return null;
}

export function addCrossfade(
  projectInput: SnapCutProject,
  crossfadeInput: SnapCutCrossfade,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  const crossfade = crossfadeInput;
  if (project.crossfades.some(({ id }) => id === crossfade.id)) {
    throw new DomainError('DUPLICATE_ID', `Crossfade ID already exists: ${crossfade.id}`);
  }
  const available = availableCrossfadeDurations(
    project,
    crossfade.leftClipId,
    crossfade.rightClipId,
  );
  if (!available.includes(crossfade.durationMs)) {
    throw new DomainError('INVALID_CROSSFADE', 'Crossfade does not fit this clip boundary.');
  }
  return snapCutProjectSchema.parse({
    ...project,
    crossfades: [...project.crossfades, crossfade],
    updatedAt,
  });
}

export function updateCrossfadeDuration(
  projectInput: SnapCutProject,
  crossfadeId: string,
  durationMs: CrossfadeDurationMs,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  const crossfade = project.crossfades.find(({ id }) => id === crossfadeId);
  if (!crossfade) throw new DomainError('CROSSFADE_NOT_FOUND', 'Crossfade no longer exists.');
  const available = availableCrossfadeDurations(
    project,
    crossfade.leftClipId,
    crossfade.rightClipId,
    crossfadeId,
  );
  if (!available.includes(durationMs)) {
    throw new DomainError('INVALID_CROSSFADE', 'Crossfade duration does not fit this boundary.');
  }
  return snapCutProjectSchema.parse({
    ...project,
    crossfades: project.crossfades.map((candidate) =>
      candidate.id === crossfadeId ? { ...candidate, durationMs } : candidate,
    ),
    updatedAt,
  });
}

export function moveCrossfade(
  projectInput: SnapCutProject,
  crossfadeId: string,
  leftClipId: string,
  rightClipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  const crossfade = project.crossfades.find(({ id }) => id === crossfadeId);
  if (!crossfade) throw new DomainError('CROSSFADE_NOT_FOUND', 'Crossfade no longer exists.');
  const available = availableCrossfadeDurations(project, leftClipId, rightClipId, crossfadeId);
  if (!available.includes(crossfade.durationMs)) {
    throw new DomainError('INVALID_CROSSFADE', 'Crossfade does not fit the requested boundary.');
  }
  return snapCutProjectSchema.parse({
    ...project,
    crossfades: project.crossfades.map((candidate) =>
      candidate.id === crossfadeId ? { ...candidate, leftClipId, rightClipId } : candidate,
    ),
    updatedAt,
  });
}

export function deleteCrossfade(
  projectInput: SnapCutProject,
  crossfadeId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  if (!project.crossfades.some(({ id }) => id === crossfadeId)) {
    throw new DomainError('CROSSFADE_NOT_FOUND', 'Crossfade no longer exists.');
  }
  return snapCutProjectSchema.parse({
    ...project,
    crossfades: project.crossfades.filter(({ id }) => id !== crossfadeId),
    updatedAt,
  });
}
