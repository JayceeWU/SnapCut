import { DEFAULT_SELECTION_DURATION_MS } from './constants';
import { DomainError } from './errors';
import { createDefaultProjectName, normalizeProjectName } from './naming';
import {
  isoDateTimeSchema,
  projectIndexFileV1Schema,
  snapCutProjectSchema,
  snapCutSourceSchema,
} from './schemas';
import { compositionDurationMs } from './timeline';
import type {
  ProjectIndexEntry,
  ProjectIndexFileV1,
  SnapCutExportRecord,
  SnapCutProject,
  SnapCutSource,
} from './types';

export interface CreateProjectInput {
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
    schemaVersion: 3,
    id: input.id,
    name: explicitName ? normalizeProjectName(explicitName) : createDefaultProjectName(date),
    namePromptCompleted: Boolean(explicitName),
    createdAt: now,
    updatedAt: now,
    sources: [],
    clips: [],
    lastExport: null,
  }) as SnapCutProject;
}

export function renameProject(
  projectInput: SnapCutProject,
  name: string,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const normalizedName = name.trim();
  if (normalizedName.length === 0) {
    throw new DomainError('INVALID_PROJECT_NAME', 'Project name cannot be blank');
  }
  return snapCutProjectSchema.parse({
    ...project,
    name: normalizeProjectName(normalizedName),
    namePromptCompleted: true,
    updatedAt,
  }) as SnapCutProject;
}

export function shouldPromptForProjectName(project: SnapCutProject): boolean {
  return !project.namePromptCompleted && project.clips.length > 0;
}

export function completeProjectNamePrompt(
  projectInput: SnapCutProject,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  return snapCutProjectSchema.parse({
    ...project,
    namePromptCompleted: true,
    updatedAt,
  }) as SnapCutProject;
}

export function addSource(
  projectInput: SnapCutProject,
  sourceInput: SnapCutSource,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  const source = snapCutSourceSchema.parse(sourceInput) as SnapCutSource;
  if (project.sources.some(({ id }) => id === source.id)) {
    throw new DomainError('DUPLICATE_ID', `Source ID already exists: ${source.id}`);
  }
  return snapCutProjectSchema.parse({
    ...project,
    sources: [...project.sources, source],
    updatedAt,
  }) as SnapCutProject;
}

export function setLastExport(
  projectInput: SnapCutProject,
  lastExport: SnapCutExportRecord,
  updatedAt = projectInput.updatedAt,
): SnapCutProject {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
  return snapCutProjectSchema.parse({ ...project, lastExport, updatedAt }) as SnapCutProject;
}

export function defaultSelectionForSource(sourceInput: SnapCutSource): {
  startMs: 0;
  endMs: number;
} {
  const source = snapCutSourceSchema.parse(sourceInput);
  return { startMs: 0, endMs: Math.min(source.durationMs, DEFAULT_SELECTION_DURATION_MS) };
}

export function projectIndexEntry(projectInput: SnapCutProject): ProjectIndexEntry {
  const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
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

export function buildProjectIndex(projects: readonly SnapCutProject[]): ProjectIndexFileV1 {
  const entries = projects
    .map(projectIndexEntry)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id),
    );

  return projectIndexFileV1Schema.parse({
    schemaVersion: 1,
    projects: entries,
  }) as ProjectIndexFileV1;
}
