import { snapCutProjectSchema, snapCutProjectV1Schema } from './schemas';
import type { SnapCutProject, SnapCutProjectV1 } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function migrateProjectV1ToV2(input: SnapCutProjectV1): SnapCutProject {
  const project = snapCutProjectV1Schema.parse(input);
  return snapCutProjectSchema.parse({
    ...project,
    schemaVersion: 2,
    sources: project.sources.map((source) => ({
      ...source,
      aacProfile: null,
      codecConfigFingerprint: null,
      encoderDelayFrames: null,
      encoderPaddingFrames: null,
      privateAudioSha256: null,
    })),
  }) as SnapCutProject;
}

/**
 * Parses current data or performs the sole supported one-way migration. Future
 * schemas are rejected rather than silently downgraded.
 */
export function parseSnapCutProject(input: unknown): SnapCutProject {
  if (!isRecord(input)) {
    return snapCutProjectSchema.parse(input) as SnapCutProject;
  }

  if (input.schemaVersion === 1) {
    return migrateProjectV1ToV2(snapCutProjectV1Schema.parse(input) as SnapCutProjectV1);
  }

  return snapCutProjectSchema.parse(input) as SnapCutProject;
}

export const migrateSnapCutProject = parseSnapCutProject;
