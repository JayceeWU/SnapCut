import { CURRENT_PROJECT_SCHEMA_VERSION, MAX_SOURCE_NAME_CODE_POINTS } from './constants';
import { DomainError } from './errors';
import { createDefaultProjectName, normalizeProjectName } from './naming';
import { isoDateTimeSchema, projectIndexSchema, snapCutProjectSchema } from './schemas';
import { compositionDurationMs } from './timeline';
import type { SnapCutProject, SnapCutSource } from './types';

interface CreateProjectInput {
  id: string;
  name?: string | null;
  now: string | Date;
}

function timestamp(value: string | Date): string {
  const result = typeof value === 'string' ? value : value.toISOString();
  return isoDateTimeSchema.parse(result);
}

export function createProject(input: CreateProjectInput): SnapCutProject {
  const date = input.now instanceof Date ? input.now : new Date(input.now);
  const now = timestamp(date);
  const explicitName = input.name?.trim();
  return snapCutProjectSchema.parse({
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: input.id,
    name: explicitName ? normalizeProjectName(explicitName) : createDefaultProjectName(date),
    namePromptCompleted: Boolean(explicitName),
    createdAt: now,
    updatedAt: now,
    sources: [],
    clips: [],
    crossfades: [],
    sourceComparisons: [],
    lastExport: null,
  });
}

export function renameProject(
  projectInput: SnapCutProject,
  name: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  const normalizedName = name.trim();
  if (normalizedName.length === 0) {
    throw new DomainError('INVALID_PROJECT_NAME', 'Project name cannot be blank');
  }
  return snapCutProjectSchema.parse({
    ...project,
    name: normalizeProjectName(normalizedName),
    namePromptCompleted: true,
    updatedAt,
  });
}

export function shouldPromptForProjectName(project: SnapCutProject): boolean {
  return !project.namePromptCompleted && project.clips.length > 0;
}

export function completeProjectNamePrompt(
  projectInput: SnapCutProject,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  return snapCutProjectSchema.parse({
    ...project,
    namePromptCompleted: true,
    updatedAt,
  });
}

export function addSource(
  projectInput: SnapCutProject,
  sourceInput: SnapCutSource,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  const source = sourceInput;
  if (project.sources.some(({ id }) => id === source.id)) {
    throw new DomainError('DUPLICATE_ID', `Source ID already exists: ${source.id}`);
  }
  return snapCutProjectSchema.parse({
    ...project,
    sources: [...project.sources, source],
    updatedAt,
  });
}

export function renameSource(
  projectInput: SnapCutProject,
  sourceId: string,
  displayName: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  const normalized = displayName.trim();
  if (normalized.length === 0 || [...normalized].length > MAX_SOURCE_NAME_CODE_POINTS) {
    throw new DomainError(
      'INVALID_SOURCE_NAME',
      `Source name must contain 1 to ${MAX_SOURCE_NAME_CODE_POINTS} Unicode characters.`,
    );
  }
  if (!project.sources.some(({ id }) => id === sourceId)) {
    throw new DomainError('SOURCE_NOT_FOUND', `Source does not exist: ${sourceId}`);
  }
  return snapCutProjectSchema.parse({
    ...project,
    sources: project.sources.map((source) =>
      source.id === sourceId ? { ...source, displayName: normalized } : source,
    ),
    updatedAt,
  });
}

export function removeUnusedSource(
  projectInput: SnapCutProject,
  sourceId: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = projectInput;
  if (!project.sources.some(({ id }) => id === sourceId)) {
    throw new DomainError('SOURCE_NOT_FOUND', `Source does not exist: ${sourceId}`);
  }
  if (project.clips.some((clip) => clip.sourceId === sourceId)) {
    throw new DomainError('SOURCE_IN_USE', 'Remove clips that use this source first.');
  }
  return snapCutProjectSchema.parse({
    ...project,
    sources: project.sources.filter(({ id }) => id !== sourceId),
    sourceComparisons: project.sourceComparisons.filter(
      (bookmark) => bookmark.sourceId !== sourceId,
    ),
    updatedAt,
  });
}

export function nextDefaultSourceName(sources: readonly SnapCutSource[]): string {
  const highest = sources.reduce((maximum, source) => {
    const match = /^S([1-9]\d*)$/u.exec(source.displayName);
    if (match === null) return maximum;
    const value = Number(match[1]);
    return Number.isSafeInteger(value) ? Math.max(maximum, value) : maximum;
  }, 0);
  return `S${highest + 1}`;
}

function projectIndexEntry(projectInput: SnapCutProject) {
  const project = projectInput;
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sourceCount: project.sources.length,
    clipCount: project.clips.length,
    compositionDurationMs: compositionDurationMs(project.clips),
  };
}

export function buildProjectIndex(projects: readonly SnapCutProject[]) {
  const entries = projects
    .map(projectIndexEntry)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id),
    );

  return projectIndexSchema.parse({
    schemaVersion: 1,
    projects: entries,
  });
}
