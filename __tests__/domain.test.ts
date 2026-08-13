import { describe, expect, test } from '@jest/globals';

import {
  DomainError,
  addClip,
  addSource,
  buildClipTimeline,
  buildProjectIndex,
  chooseDefaultExportFormat,
  chooseOutputChannelCount,
  chooseOutputSampleRateHz,
  compositionDurationMs,
  createDefaultExportBaseName,
  createProject,
  defaultSelectionForSource,
  deleteClip,
  duplicateClip,
  estimateMp3OutputBytes,
  mapCompositionPosition,
  m4aExportPlanSchema,
  migrateProjectV1ToV2,
  moveClipEarlier,
  moveClipLater,
  normalizeProjectName,
  parseSnapCutProject,
  projectIndexSchema,
  renameProject,
  snapCutExportRecordSchema,
  snapCutProjectSchema,
  snapCutSourceSchema,
  sourceFileSchema,
  updateClip,
  validateExportBaseName,
} from '@/domain';
import type { SnapCutClip, SnapCutProject, SnapCutProjectV1, SnapCutSource } from '@/domain';
import { formatExactTime, parseExactTime } from '@/utils';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_A_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_B_ID = '33333333-3333-4333-8333-333333333333';
const CLIP_A_ID = '44444444-4444-4444-8444-444444444444';
const CLIP_B_ID = '55555555-5555-4555-8555-555555555555';
const CLIP_C_ID = '66666666-6666-4666-8666-666666666666';
const CREATED_AT = '2026-08-12T20:00:00.000Z';
const UPDATED_AT = '2026-08-12T20:01:00.000Z';

function makeSource(overrides: Partial<SnapCutSource> = {}): SnapCutSource {
  return {
    id: SOURCE_A_ID,
    displayName: 'Source.mp3',
    originalMimeType: 'audio/mpeg',
    sourceKind: 'mp3',
    privateAudioFileName: 'source.mp3',
    durationMs: 60_000,
    codecMime: 'audio/mpeg',
    sampleRateHz: 44_100,
    channelCount: 2,
    encodedBitrateBps: 320_000,
    pcmBitsPerSample: null,
    aacProfile: null,
    codecConfigFingerprint: null,
    encoderDelayFrames: null,
    encoderPaddingFrames: null,
    privateAudioSha256: null,
    fileSizeBytes: 2_400_000,
    waveformFileName: 'waveform.json',
    waveformStatus: 'ready',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function makeClip(overrides: Partial<SnapCutClip> = {}): SnapCutClip {
  return {
    id: CLIP_A_ID,
    sourceId: SOURCE_A_ID,
    startMs: 1_000,
    endMs: 2_000,
    ...overrides,
  };
}

function makeProject(): SnapCutProject {
  return addSource(
    createProject({ id: PROJECT_ID, name: 'Demo', now: CREATED_AT }),
    makeSource(),
    UPDATED_AT,
  );
}

describe('strict persisted schemas and migration', () => {
  test('parses a valid schema v2 project and rejects unknown persisted fields', () => {
    const project = makeProject();
    expect(snapCutProjectSchema.parse(project)).toEqual(project);
    expect(() =>
      snapCutProjectSchema.parse({ ...project, sourceUri: 'content://provider/item' }),
    ).toThrow();
  });

  test('never persists a provider URI on a source or source mirror', () => {
    const project = makeProject();
    const sourceWithProviderUri = {
      ...project.sources[0],
      sourceUri: 'content://provider/private?token=secret',
    };

    expect(() =>
      snapCutProjectSchema.parse({ ...project, sources: [sourceWithProviderUri] }),
    ).toThrow();
    expect(() =>
      sourceFileSchema.parse({
        schemaVersion: 1,
        projectId: PROJECT_ID,
        source: sourceWithProviderUri,
      }),
    ).toThrow();
  });

  test('accepts a private FLAC source and treats it as non-AAC media', () => {
    const flac = makeSource({
      displayName: 'Lossless.flac',
      originalMimeType: 'audio/flac',
      sourceKind: 'flac',
      privateAudioFileName: 'source.flac',
      codecMime: 'audio/flac',
      encodedBitrateBps: null,
      pcmBitsPerSample: 24,
    });

    expect(snapCutSourceSchema.parse(flac)).toEqual(flac);
    expect(() =>
      snapCutSourceSchema.parse({
        ...flac,
        aacProfile: 'aac-lc',
        codecConfigFingerprint: 'a'.repeat(64),
      }),
    ).toThrow('Non-AAC sources');
  });

  test('migrates schema v1 once and initializes newly introduced AAC metadata to null', () => {
    const source = makeSource();
    const {
      aacProfile: _aacProfile,
      codecConfigFingerprint: _fingerprint,
      encoderDelayFrames: _delay,
      encoderPaddingFrames: _padding,
      privateAudioSha256: _privateAudioSha256,
      ...sourceV1
    } = source;
    const v1: SnapCutProjectV1 = {
      schemaVersion: 1,
      id: PROJECT_ID,
      name: 'Legacy',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      sources: [sourceV1],
      clips: [makeClip()],
      lastExport: null,
    };

    const migrated = migrateProjectV1ToV2(v1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.clips).toEqual(v1.clips);
    expect(migrated.sources[0]).toMatchObject({
      id: SOURCE_A_ID,
      aacProfile: null,
      codecConfigFingerprint: null,
      encoderDelayFrames: null,
      encoderPaddingFrames: null,
      privateAudioSha256: null,
    });
    expect(parseSnapCutProject(v1)).toEqual(migrated);
  });

  test('rejects invalid relations, fractional milliseconds, future schemas, and 99 ms clips', () => {
    const project = makeProject();
    expect(() =>
      snapCutProjectSchema.parse({
        ...project,
        clips: [makeClip({ startMs: 1.5 })],
      }),
    ).toThrow();
    expect(() =>
      snapCutProjectSchema.parse({
        ...project,
        clips: [makeClip({ startMs: 100, endMs: 199 })],
      }),
    ).toThrow();
    expect(() =>
      snapCutProjectSchema.parse({
        ...project,
        clips: [makeClip({ sourceId: SOURCE_B_ID })],
      }),
    ).toThrow();
    expect(() => parseSnapCutProject({ ...project, schemaVersion: 3 })).toThrow();
  });

  test('enforces truthful export record fields', () => {
    const base = {
      displayName: 'Demo.mp3',
      contentUri: 'content://media/external/audio/1',
      exportedAt: UPDATED_AT,
      requestedDurationMs: 1_000,
      actualDurationMs: 1_020,
      sampleRateHz: 44_100,
      channelCount: 2 as const,
      maxBoundaryAdjustmentMs: 0,
      fileSizeBytes: 40_000,
    };
    expect(
      snapCutExportRecordSchema.parse({
        ...base,
        format: 'mp3',
        mode: 'mp3-lossy-encode',
        bitrateKbps: 320,
        bitsPerSample: null,
      }),
    ).toBeDefined();
    expect(() =>
      snapCutExportRecordSchema.parse({
        ...base,
        format: 'flac',
        mode: 'flac-lossless-encode',
        bitrateKbps: 320,
        bitsPerSample: 24,
      }),
    ).toThrow();
  });

  test('strictly binds eligible M4A plans to immutable source snapshots', () => {
    const fingerprint = 'b'.repeat(64);
    const plan = {
      planVersion: 1,
      planId: '77777777-7777-4777-8777-777777777777',
      createdAt: UPDATED_AT,
      eligible: true,
      reasons: [],
      codecConfigFingerprint: fingerprint,
      sampleRateHz: 48_000,
      channelCount: 2,
      maxBoundaryAdjustmentMs: 2,
      estimatedOutputBytes: 20_000,
      sourceSnapshots: [
        {
          sourceId: SOURCE_A_ID,
          privateAudioSha256: 'a'.repeat(64),
          codecConfigFingerprint: fingerprint,
          fileSizeBytes: 50_000,
          lastModifiedEpochMs: 1_765_000_000_000,
        },
      ],
      clips: [
        {
          clipId: CLIP_A_ID,
          sourceId: SOURCE_A_ID,
          requestedStartMs: 1_000,
          requestedEndMs: 2_000,
          effectiveStartUs: 1_002_000,
          effectiveEndUs: 1_998_000,
          startAdjustmentMs: 2,
          endAdjustmentMs: -2,
          estimatedEncodedBytes: 20_000,
        },
      ],
    } as const;

    expect(m4aExportPlanSchema.parse(plan)).toEqual(plan);
    const { planId: _planId, ...withoutPlanId } = plan;
    expect(() => m4aExportPlanSchema.parse(withoutPlanId)).toThrow();
    expect(() =>
      m4aExportPlanSchema.parse({
        ...plan,
        sourceSnapshots: [{ ...plan.sourceSnapshots[0], codecConfigFingerprint: 'c'.repeat(64) }],
      }),
    ).toThrow();
  });
});

describe('project and clip operations', () => {
  test('normalizes a default name and validates names by Unicode code point', () => {
    expect(normalizeProjectName('   ')).toBe('Untitled Project');
    expect(normalizeProjectName(` ${'🎵'.repeat(80)} `)).toBe('🎵'.repeat(80));
    expect(() => normalizeProjectName('🎵'.repeat(81))).toThrow(DomainError);
    expect(() => renameProject(makeProject(), '   ')).toThrow(DomainError);
  });

  test('adds, edits, duplicates, moves, and deletes clips without mutating snapshots', () => {
    const original = makeProject();
    const withA = addClip(original, makeClip(), UPDATED_AT);
    const withB = addClip(
      withA,
      makeClip({ id: CLIP_B_ID, startMs: 3_000, endMs: 4_500 }),
      UPDATED_AT,
    );
    const edited = updateClip(
      withB,
      CLIP_A_ID,
      { sourceId: SOURCE_A_ID, startMs: 500, endMs: 800 },
      UPDATED_AT,
    );
    const duplicated = duplicateClip(edited, CLIP_A_ID, CLIP_C_ID, UPDATED_AT);
    const movedLater = moveClipLater(duplicated, CLIP_A_ID, UPDATED_AT);
    const movedEarlier = moveClipEarlier(movedLater, CLIP_A_ID, UPDATED_AT);
    const deleted = deleteClip(movedEarlier, CLIP_B_ID, UPDATED_AT);

    expect(original.clips).toEqual([]);
    expect(edited.clips[0]).toMatchObject({ startMs: 500, endMs: 800 });
    expect(duplicated.clips.map(({ id }) => id)).toEqual([CLIP_A_ID, CLIP_C_ID, CLIP_B_ID]);
    expect(movedLater.clips.map(({ id }) => id)).toEqual([CLIP_C_ID, CLIP_A_ID, CLIP_B_ID]);
    expect(movedEarlier.clips.map(({ id }) => id)).toEqual([CLIP_A_ID, CLIP_C_ID, CLIP_B_ID]);
    expect(deleted.clips.map(({ id }) => id)).toEqual([CLIP_A_ID, CLIP_C_ID]);
  });

  test('rejects invalid clip operations with stable domain codes', () => {
    const project = makeProject();
    expect(() => addClip(project, makeClip({ startMs: 0, endMs: 99 }))).toThrow(
      expect.objectContaining({ code: 'INVALID_CLIP_RANGE' }),
    );
    expect(() => addClip(project, makeClip({ sourceId: SOURCE_B_ID }))).toThrow(
      expect.objectContaining({ code: 'SOURCE_NOT_FOUND' }),
    );
    const withClip = addClip(project, makeClip());
    expect(() => moveClipEarlier(withClip, CLIP_A_ID)).toThrow(
      expect.objectContaining({ code: 'MOVE_OUT_OF_BOUNDS' }),
    );
  });

  test('creates the default 30-second editor selection', () => {
    expect(defaultSelectionForSource(makeSource())).toEqual({ startMs: 0, endMs: 30_000 });
    expect(defaultSelectionForSource(makeSource({ durationMs: 5_000 }))).toEqual({
      startMs: 0,
      endMs: 5_000,
    });
  });
});

describe('composition timeline', () => {
  const clips = [
    makeClip({ startMs: 1_000, endMs: 2_000 }),
    makeClip({ id: CLIP_B_ID, startMs: 10_000, endMs: 12_500 }),
  ];

  test('builds contiguous prefix sums and total duration', () => {
    expect(buildClipTimeline(clips)).toEqual([
      { clipId: CLIP_A_ID, compositionStartMs: 0, compositionEndMs: 1_000 },
      { clipId: CLIP_B_ID, compositionStartMs: 1_000, compositionEndMs: 3_500 },
    ]);
    expect(compositionDurationMs(clips)).toBe(3_500);
  });

  test('maps half-open composition boundaries to source positions', () => {
    expect(mapCompositionPosition(clips, 999)).toMatchObject({
      clipId: CLIP_A_ID,
      sourcePositionMs: 1_999,
    });
    expect(mapCompositionPosition(clips, 1_000)).toMatchObject({
      clipId: CLIP_B_ID,
      clipIndex: 1,
      positionInClipMs: 0,
      sourcePositionMs: 10_000,
    });
    expect(mapCompositionPosition(clips, 3_500)).toBeNull();
  });
});

describe('export and time policies', () => {
  test('selects the documented decoded output sample rate', () => {
    expect(chooseOutputSampleRateHz([32_000, 32_000])).toBe(32_000);
    expect(chooseOutputSampleRateHz([44_100, 44_100])).toBe(44_100);
    expect(chooseOutputSampleRateHz([44_100, 48_000])).toBe(48_000);
    expect(chooseOutputSampleRateHz([22_050, 44_100])).toBe(44_100);
    expect(chooseOutputSampleRateHz([96_000])).toBe(48_000);
  });

  test('selects mono only when every clip is mono and rejects more channels', () => {
    expect(chooseOutputChannelCount([1, 1])).toBe(1);
    expect(chooseOutputChannelCount([1, 2])).toBe(2);
    expect(() => chooseOutputChannelCount([6])).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CHANNEL_COUNT' }),
    );
  });

  test('defaults to M4A only when eligible and never auto-selects MP3', () => {
    expect(chooseDefaultExportFormat(true)).toBe('m4a');
    expect(chooseDefaultExportFormat(false)).toBe('flac');
    expect(estimateMp3OutputBytes(1_000)).toBe(40_000);
  });

  test('parses and formats exact integer millisecond timestamps', () => {
    expect(parseExactTime('05.123')).toBe(5_123);
    expect(parseExactTime('2:05.123')).toBe(125_123);
    expect(parseExactTime('1:02:05.123')).toBe(3_725_123);
    expect(formatExactTime(3_725_123)).toBe('1:02:05.123');
    expect(() => parseExactTime('1:60.000')).toThrow(DomainError);
  });

  test('creates safe extension-free export base names', () => {
    expect(createDefaultExportBaseName('Demo', new Date(2026, 7, 12, 14, 3, 5))).toBe(
      'Demo - 20260812-140305',
    );
    expect(() => validateExportBaseName('../Demo.mp3')).toThrow(DomainError);
  });

  test('builds and strictly validates the rebuildable index', () => {
    const newer = addClip(makeProject(), makeClip(), UPDATED_AT);
    const index = buildProjectIndex([newer]);
    expect(index.projects[0]).toMatchObject({
      sourceCount: 1,
      clipCount: 1,
      compositionDurationMs: 1_000,
    });
    expect(projectIndexSchema.parse(index)).toEqual(index);
    expect(() => projectIndexSchema.parse({ ...index, providerUri: 'content://x' })).toThrow();
  });
});
