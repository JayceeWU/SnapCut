import {
  snapCutProjectSchema,
  snapCutProjectV1Schema,
  snapCutProjectV2Schema,
  snapCutProjectV3Schema,
  snapCutProjectV4Schema,
  snapCutProjectV5Schema,
  snapCutProjectV6Schema,
} from './schemas';
import { MIN_CLIP_DURATION_MS } from './constants';
import type {
  SnapCutClipV5,
  SnapCutClipV1,
  SnapCutProject,
  SnapCutProjectV1,
  SnapCutProjectV2,
  SnapCutProjectV3,
  SnapCutProjectV4,
  SnapCutProjectV5,
  SnapCutProjectV6,
  SnapCutSource,
} from './types';

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

export function migrateProjectV2ToV3(input: SnapCutProjectV2): SnapCutProjectV3 {
  const project = snapCutProjectV2Schema.parse(input);
  return snapCutProjectV3Schema.parse({
    ...project,
    schemaVersion: 3,
    namePromptCompleted: true,
  }) as SnapCutProjectV3;
}

function migrateLegacyClips(clips: readonly SnapCutClipV1[]): SnapCutClipV5[] {
  let timelineStartMs = 0;
  return clips.map((clip) => {
    const migrated: SnapCutClipV5 = {
      ...clip,
      trackId: 'track-1',
      timelineStartMs,
      gain: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
    };
    timelineStartMs += clip.endMs - clip.startMs;
    return migrated;
  });
}

function fullSourceClips(sources: readonly SnapCutSource[]): SnapCutClipV5[] {
  let timelineStartMs = 0;
  return sources.flatMap((source) => {
    if (source.durationMs < MIN_CLIP_DURATION_MS) return [];
    // Source and clip IDs live in separate identity domains. Reusing the
    // already-persisted source UUID keeps this migration deterministic across
    // interrupted recovery attempts without inventing a random on-disk value.
    const clip: SnapCutClipV5 = {
      id: source.id,
      sourceId: source.id,
      startMs: 0,
      endMs: source.durationMs,
      trackId: 'track-1',
      timelineStartMs,
      gain: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
    };
    timelineStartMs += source.durationMs;
    return [clip];
  });
}

export function migrateProjectV3ToV4(input: SnapCutProjectV3): SnapCutProjectV4 {
  const project = snapCutProjectV3Schema.parse(input) as SnapCutProjectV3;
  return snapCutProjectV4Schema.parse({
    ...project,
    schemaVersion: 4,
    trackCount: 1,
    clips:
      project.clips.length > 0
        ? migrateLegacyClips(project.clips)
        : fullSourceClips(project.sources),
  }) as SnapCutProjectV4;
}

export function migrateProjectV4ToV5(input: SnapCutProjectV4): SnapCutProjectV5 {
  const project = snapCutProjectV4Schema.parse(input) as SnapCutProjectV4;
  return snapCutProjectV5Schema.parse({
    ...project,
    schemaVersion: 5,
    trackCount: 2,
  }) as SnapCutProjectV5;
}

export function migrateProjectV5ToV6(input: SnapCutProjectV5): SnapCutProjectV6 {
  const project = snapCutProjectV5Schema.parse(input) as SnapCutProjectV5;
  return snapCutProjectV6Schema.parse({
    ...project,
    schemaVersion: 6,
  }) as SnapCutProjectV6;
}

/**
 * v7 is a deliberate storage-generation boundary. Older project JSON is never
 * migrated into the new ordered-clip model; startup storage reset removes it
 * before recovery. Rejecting it here also prevents a partial reset from making
 * legacy metadata visible.
 */
export function parseSnapCutProject(input: unknown): SnapCutProject {
  if (isRecord(input) && input.schemaVersion !== 7) {
    throw new Error('Legacy project metadata is not supported by storage generation v7.');
  }
  return snapCutProjectSchema.parse(input) as SnapCutProject;
}

export const migrateSnapCutProject = parseSnapCutProject;
