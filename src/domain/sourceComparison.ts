import { MIN_CLIP_DURATION_MS } from './constants';
import { DomainError } from './errors';
import { snapCutProjectSchema, sourceComparisonBookmarkSchema } from './schemas';
import type { SnapCutProject, SourceComparisonBookmark } from './types';

export function validateSourceComparisonBookmark(
  project: SnapCutProject,
  sourceId: string,
  firstMs: number,
  secondMs: number,
): SourceComparisonBookmark {
  const source = project.sources.find(({ id }) => id === sourceId);
  if (!source) throw new DomainError('SOURCE_NOT_FOUND', `Source does not exist: ${sourceId}`);
  const bookmark = sourceComparisonBookmarkSchema.parse({ sourceId, firstMs, secondMs });
  if (
    bookmark.firstMs < MIN_CLIP_DURATION_MS ||
    source.durationMs - bookmark.secondMs < MIN_CLIP_DURATION_MS
  ) {
    throw new DomainError(
      'INVALID_CLIP_RANGE',
      'Comparison points must leave two clips of at least 100 milliseconds.',
    );
  }
  return bookmark;
}

export function setSourceComparisonBookmark(
  projectInput: SnapCutProject,
  sourceId: string,
  firstMs: number,
  secondMs: number,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  const bookmark = validateSourceComparisonBookmark(project, sourceId, firstMs, secondMs);
  const sourceComparisons = project.sourceComparisons.filter(
    (candidate) => candidate.sourceId !== sourceId,
  );
  return snapCutProjectSchema.parse({
    ...project,
    sourceComparisons: [...sourceComparisons, bookmark],
    updatedAt,
  });
}

export function appendSourceComparisonClips(
  projectInput: SnapCutProject,
  sourceId: string,
  firstClipId: string,
  secondClipId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  const bookmark = project.sourceComparisons.find((candidate) => candidate.sourceId === sourceId);
  if (!bookmark) {
    throw new DomainError('INVALID_CLIP_RANGE', 'Set comparison points before adding clips.');
  }
  const validated = validateSourceComparisonBookmark(
    project,
    sourceId,
    bookmark.firstMs,
    bookmark.secondMs,
  );
  const source = project.sources.find(({ id }) => id === sourceId)!;
  if (
    firstClipId === secondClipId ||
    project.clips.some(({ id }) => id === firstClipId || id === secondClipId)
  ) {
    throw new DomainError('DUPLICATE_ID', 'Comparison Clip IDs must be new and unique.');
  }
  return snapCutProjectSchema.parse({
    ...project,
    clips: [
      ...project.clips,
      { id: firstClipId, sourceId, startMs: 0, endMs: validated.firstMs },
      {
        id: secondClipId,
        sourceId,
        startMs: validated.secondMs,
        endMs: source.durationMs,
      },
    ],
    updatedAt,
  });
}
