import { snapCutProjectSchema, snapCutProjectV1Schema, snapCutProjectV2Schema } from './schemas';
import type { SnapCutProject, SnapCutProjectV1, SnapCutProjectV2 } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function migrateProjectV1ToV2(input: SnapCutProjectV1): SnapCutProjectV2 {
  const project = snapCutProjectV1Schema.parse(input);
  return snapCutProjectV2Schema.parse({
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
  }) as SnapCutProjectV2;
}

export function migrateProjectV2ToV3(input: SnapCutProjectV2): SnapCutProject {
  const project = snapCutProjectV2Schema.parse(input);
  return snapCutProjectSchema.parse({
    ...project,
    schemaVersion: 3,
    namePromptCompleted: true,
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
    return migrateProjectV2ToV3(
      migrateProjectV1ToV2(snapCutProjectV1Schema.parse(input) as SnapCutProjectV1),
    );
  }

  if (input.schemaVersion === 2) {
    return migrateProjectV2ToV3(snapCutProjectV2Schema.parse(input) as SnapCutProjectV2);
  }

  return snapCutProjectSchema.parse(input) as SnapCutProject;
}

export const migrateSnapCutProject = parseSnapCutProject;
