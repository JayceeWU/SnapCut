import { describe, expect, test } from '@jest/globals';

import {
  DomainError,
  addClip,
  addFullSourceClip,
  addSource,
  buildClipTimeline,
  buildProjectIndex,
  chooseDefaultExportFormat,
  chooseOutputChannelCount,
  chooseOutputSampleRateHz,
  compositionDurationMs,
  completeProjectNamePrompt,
  createDefaultExportBaseName,
  createDefaultProjectName,
  createProject,
  defaultSelectionForSource,
  deleteClip,
  duplicateClip,
  estimateMp3OutputBytes,
  exportPreflightResultSchema,
  fitFadeDurationMs,
  mapCompositionPosition,
  mapTimelinePositionToClips,
  m4aExportPlanSchema,
  migrateProjectV1ToV2,
  migrateProjectV2ToV3,
  migrateProjectV3ToV4,
  migrateProjectV4ToV5,
  migrateProjectV5ToV6,
  moveClipEarlier,
  moveClipLater,
  normalizeProjectName,
  parseSnapCutProject,
  projectIndexSchema,
  renameProject,
  snapCutExportRecordSchema,
  snapCutProjectSchema,
  snapCutSourceSchema,
  shouldPromptForProjectName,
  sourceFileSchema,
  splitClip,
  snapClipTimelineStartMs,
  trimClipEdge,
  updateClip,
  validateExportBaseName,
} from '@/domain';
import type {
  SnapCutClip,
  SnapCutProject,
  SnapCutProjectV1,
  SnapCutProjectV2,
  SnapCutProjectV3,
  SnapCutProjectV4,
  SnapCutProjectV5,
  SnapCutSource,
} from '@/domain';
import { formatExactTime, parseExactTime } from '@/utils';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_A_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_B_ID = '33333333-3333-4333-8333-333333333333';
const CLIP_A_ID = '44444444-4444-4444-8444-444444444444';
const CLIP_B_ID = '55555555-5555-4555-8555-555555555555';
const CLIP_C_ID = '66666666-6666-4666-8666-666666666666';
const CLIP_D_ID = '77777777-7777-4777-8777-777777777777';
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
    trackId: 'track-1',
    timelineStartMs: 0,
    gain: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
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
  test('parses a valid schema v6 project and rejects unknown persisted fields', () => {
    const project = makeProject();
    expect(snapCutProjectSchema.parse(project)).toEqual(project);
    expect(() =>
      snapCutProjectSchema.parse({ ...project, sourceUri: 'content://provider/item' }),
    ).toThrow();
    expect(() => snapCutProjectSchema.parse({ ...project, trackCount: 1 })).toThrow();
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

  test('migrates schema v1 through v6 and preserves legacy content', () => {
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
      clips: [{ id: CLIP_A_ID, sourceId: SOURCE_A_ID, startMs: 1_000, endMs: 2_000 }],
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
    expect(parseSnapCutProject(v1)).toMatchObject({
      schemaVersion: 6,
      trackCount: 2,
      namePromptCompleted: true,
      clips: [
        expect.objectContaining({
          id: CLIP_A_ID,
          trackId: 'track-1',
          timelineStartMs: 0,
          gain: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
        }),
      ],
    });
  });

  test('migrates schema v2 to v3 without prompting existing projects', () => {
    const current = makeProject();
    const { namePromptCompleted: _completed, trackCount: _trackCount, ...rest } = current;
    const v2 = { ...rest, schemaVersion: 2 } as SnapCutProjectV2;

    expect(migrateProjectV2ToV3(v2)).toEqual({
      ...v2,
      schemaVersion: 3,
      namePromptCompleted: true,
    });
    expect(parseSnapCutProject(v2)).toEqual(
      migrateProjectV5ToV6(migrateProjectV4ToV5(migrateProjectV3ToV4(migrateProjectV2ToV3(v2)))),
    );
  });

  test('migrates v3 clips sequentially and creates full-source clips for source-only projects', () => {
    const current = makeProject();
    const {
      trackCount: _trackCount,
      clips: _clips,
      schemaVersion: _version,
      ...legacyBase
    } = current;
    const v3WithClips: SnapCutProjectV3 = {
      ...legacyBase,
      schemaVersion: 3,
      clips: [
        { id: CLIP_A_ID, sourceId: SOURCE_A_ID, startMs: 1_000, endMs: 2_000 },
        { id: CLIP_B_ID, sourceId: SOURCE_A_ID, startMs: 3_000, endMs: 4_500 },
      ],
    };
    expect(migrateProjectV3ToV4(v3WithClips).clips).toEqual([
      makeClip(),
      makeClip({
        id: CLIP_B_ID,
        startMs: 3_000,
        endMs: 4_500,
        timelineStartMs: 1_000,
      }),
    ]);
    expect(parseSnapCutProject(v3WithClips)).toEqual(
      migrateProjectV5ToV6(migrateProjectV4ToV5(migrateProjectV3ToV4(v3WithClips))),
    );

    const sourceOnly: SnapCutProjectV3 = { ...v3WithClips, clips: [] };
    expect(migrateProjectV3ToV4(sourceOnly).clips).toEqual([
      makeClip({ id: SOURCE_A_ID, startMs: 0, endMs: 60_000 }),
    ]);
  });

  test('retains a sub-100ms legacy source but skips an invalid automatic full clip', () => {
    const current = makeProject();
    const tinySource = makeSource({ durationMs: 99 });
    const {
      trackCount: _trackCount,
      clips: _clips,
      schemaVersion: _version,
      ...legacyBase
    } = current;
    const v3: SnapCutProjectV3 = {
      ...legacyBase,
      schemaVersion: 3,
      sources: [tinySource],
      clips: [],
    };
    const migrated = migrateProjectV3ToV4(v3);
    expect(migrated.sources).toEqual([tinySource]);
    expect(migrated.clips).toEqual([]);
  });

  test('migrates v4 through v6 while preserving project data', () => {
    const current = addClip(makeProject(), makeClip({ gain: 0.5, fadeInMs: 500, fadeOutMs: 500 }));
    const exportRecord = {
      format: 'mp3' as const,
      mode: 'mp3-lossy-encode' as const,
      displayName: 'Legacy.mp3',
      contentUri: 'content://media/external/audio/42',
      exportedAt: UPDATED_AT,
      requestedDurationMs: 1_000,
      actualDurationMs: 1_000,
      sampleRateHz: 44_100,
      channelCount: 2 as const,
      bitrateKbps: 320 as const,
      bitsPerSample: null,
      maxBoundaryAdjustmentMs: 0,
      fileSizeBytes: 40_000,
    };
    const v4: SnapCutProjectV4 = {
      ...current,
      schemaVersion: 4,
      trackCount: 1,
      clips: current.clips as SnapCutProjectV4['clips'],
      lastExport: exportRecord,
    };

    const v5: SnapCutProjectV5 = migrateProjectV4ToV5(v4);
    const migrated = migrateProjectV5ToV6(v5);
    expect(v5).toEqual({ ...v4, schemaVersion: 5, trackCount: 2 });
    expect(migrated).toEqual({ ...v5, schemaVersion: 6 });
    expect(parseSnapCutProject(v4)).toEqual(migrated);
    expect(parseSnapCutProject(v5)).toEqual(migrated);
    expect(migrated.clips[0]).toMatchObject({ gain: 0.5, fadeInMs: 500, fadeOutMs: 500 });
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
    expect(() => parseSnapCutProject({ ...project, schemaVersion: 7 })).toThrow();
  });

  test('accepts half-second fades through six seconds and rejects invalid envelopes', () => {
    const project = makeProject();
    const supported = makeClip({
      startMs: 0,
      endMs: 12_000,
      fadeInMs: 6_000,
      fadeOutMs: 6_000,
    });
    expect(snapCutProjectSchema.parse({ ...project, clips: [supported] }).clips[0]).toEqual(
      supported,
    );
    expect(fitFadeDurationMs(5_750, 5_250)).toBe(5_000);
    expect(fitFadeDurationMs(7_000, 8_000)).toBe(6_000);
    expect(() =>
      snapCutProjectSchema.parse({
        ...project,
        clips: [makeClip({ fadeInMs: 250 as never })],
      }),
    ).toThrow();
    expect(() =>
      snapCutProjectSchema.parse({
        ...project,
        clips: [makeClip({ startMs: 0, endMs: 12_000, fadeInMs: 6_500 as never })],
      }),
    ).toThrow();
    expect(() =>
      snapCutProjectSchema.parse({
        ...project,
        clips: [makeClip({ startMs: 0, endMs: 500, fadeInMs: 500, fadeOutMs: 500 })],
      }),
    ).toThrow('Fade-in and fade-out');
    expect(() =>
      snapCutProjectSchema.parse({ ...project, clips: [makeClip({ gain: 1.01 })] }),
    ).toThrow();
    expect(() =>
      snapCutProjectSchema.parse({
        ...project,
        clips: [makeClip(), makeClip({ id: CLIP_B_ID, timelineStartMs: 500 })],
      }),
    ).toThrow('same track');
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

  test('accepts AAC re-encode as the preferred M4A path without a stream-copy plan', () => {
    const ineligiblePlan = {
      planVersion: 1,
      planId: '77777777-7777-4777-8777-777777777778',
      createdAt: UPDATED_AT,
      eligible: false,
      reasons: ['The timeline requires audio processing.'],
      codecConfigFingerprint: null,
      sampleRateHz: null,
      channelCount: null,
      maxBoundaryAdjustmentMs: 0,
      estimatedOutputBytes: null,
      sourceSnapshots: [],
      clips: [],
    } as const;
    const result = {
      preferredFormat: 'm4a',
      mayClip: true,
      m4aPlan: ineligiblePlan,
      formats: [
        {
          format: 'm4a',
          mode: 'aac-lossy-encode',
          available: true,
          reasons: [],
          estimatedOutputBytes: 400_000,
          requiredFreeBytes: 17_600_000,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
        {
          format: 'flac',
          mode: 'flac-lossless-encode',
          available: true,
          reasons: [],
          estimatedOutputBytes: 2_000_000,
          requiredFreeBytes: 21_000_000,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
        {
          format: 'mp3',
          mode: 'mp3-lossy-encode',
          available: true,
          reasons: [],
          estimatedOutputBytes: 400_000,
          requiredFreeBytes: 17_600_000,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
      ],
    } as const;
    expect(exportPreflightResultSchema.parse(result)).toEqual(result);
  });
});

describe('project and clip operations', () => {
  test('creates local timestamp project names and rejects invalid dates', () => {
    const localDate = new Date(2026, 7, 13, 14, 30, 25);
    expect(createDefaultProjectName(localDate)).toBe('2026-08-13 14-30-25');
    expect(createProject({ id: PROJECT_ID, now: localDate })).toMatchObject({
      schemaVersion: 6,
      trackCount: 2,
      name: '2026-08-13 14-30-25',
      namePromptCompleted: false,
    });
    expect(createProject({ id: PROJECT_ID, name: 'Named', now: localDate })).toMatchObject({
      name: 'Named',
      namePromptCompleted: true,
    });
    expect(() => createDefaultProjectName(new Date(Number.NaN))).toThrow(DomainError);
  });

  test('prompts only after the first clip and can complete the prompt without renaming', () => {
    const automatic = createProject({ id: PROJECT_ID, now: CREATED_AT });
    expect(shouldPromptForProjectName(automatic)).toBe(false);

    const withFirstClip = addSource(automatic, makeSource());
    const saved = addClip(withFirstClip, makeClip());
    expect(shouldPromptForProjectName(saved)).toBe(true);

    const completed = completeProjectNamePrompt(saved, UPDATED_AT);
    expect(completed).toMatchObject({
      name: automatic.name,
      namePromptCompleted: true,
      updatedAt: UPDATED_AT,
    });
    expect(shouldPromptForProjectName(completed)).toBe(false);
    expect(shouldPromptForProjectName(updateClip(completed, CLIP_A_ID, makeClip()))).toBe(false);
  });

  test('normalizes a default name and validates names by Unicode code point', () => {
    expect(normalizeProjectName('   ')).toBe('Untitled Project');
    expect(normalizeProjectName(` ${'🎵'.repeat(80)} `)).toBe('🎵'.repeat(80));
    expect(() => normalizeProjectName('🎵'.repeat(81))).toThrow(DomainError);
    expect(() => renameProject(makeProject(), '   ')).toThrow(DomainError);
    expect(
      renameProject(createProject({ id: PROJECT_ID, now: CREATED_AT }), 'Manual'),
    ).toMatchObject({ name: 'Manual', namePromptCompleted: true });
  });

  test('adds, edits, duplicates, moves, and deletes clips without mutating snapshots', () => {
    const original = makeProject();
    const withA = addClip(original, makeClip(), UPDATED_AT);
    const withB = addClip(
      withA,
      makeClip({
        id: CLIP_B_ID,
        startMs: 3_000,
        endMs: 4_500,
        timelineStartMs: 1_000,
      }),
      UPDATED_AT,
    );
    const edited = updateClip(
      withB,
      CLIP_A_ID,
      { sourceId: SOURCE_A_ID, startMs: 500, endMs: 800 },
      UPDATED_AT,
    );
    const duplicated = duplicateClip(edited, CLIP_A_ID, CLIP_C_ID, UPDATED_AT);
    const movedLater = moveClipLater(duplicated, CLIP_B_ID, UPDATED_AT);
    const movedEarlier = moveClipEarlier(movedLater, CLIP_B_ID, UPDATED_AT);
    const deleted = deleteClip(movedEarlier, CLIP_B_ID, UPDATED_AT);

    expect(original.clips).toEqual([]);
    expect(edited.clips[0]).toMatchObject({ startMs: 500, endMs: 800 });
    expect(duplicated.clips.map(({ id }) => id)).toEqual([CLIP_A_ID, CLIP_C_ID, CLIP_B_ID]);
    expect(movedLater.clips.find(({ id }) => id === CLIP_B_ID)?.timelineStartMs).toBeGreaterThan(
      duplicated.clips.find(({ id }) => id === CLIP_B_ID)!.timelineStartMs,
    );
    expect(movedEarlier.clips.find(({ id }) => id === CLIP_B_ID)?.timelineStartMs).toBeLessThan(
      movedLater.clips.find(({ id }) => id === CLIP_B_ID)!.timelineStartMs,
    );
    expect(deleted.clips.map(({ id }) => id)).toEqual([CLIP_A_ID, CLIP_C_ID]);
  });

  test('supports fixed two tracks, gaps, cross-track overlap, snapping, gain, fades, and split', () => {
    const withTrackOne = addClip(
      makeProject(),
      makeClip({ startMs: 0, endMs: 4_000, fadeInMs: 1_000, fadeOutMs: 1_000 }),
      UPDATED_AT,
    );
    const withOverlap = addClip(
      withTrackOne,
      makeClip({
        id: CLIP_B_ID,
        startMs: 5_000,
        endMs: 8_000,
        trackId: 'track-2',
        timelineStartMs: 1_000,
        gain: 0.5,
        fadeInMs: 500,
        fadeOutMs: 500,
      }),
      UPDATED_AT,
    );
    expect(withOverlap.clips).toHaveLength(2);
    expect(() =>
      addClip(withOverlap, makeClip({ id: CLIP_C_ID, timelineStartMs: 2_000 }), UPDATED_AT),
    ).toThrow(expect.objectContaining({ code: 'CLIP_COLLISION' }));

    const requested = makeClip({ id: CLIP_C_ID, startMs: 10_000, endMs: 12_000 });
    expect(snapClipTimelineStartMs(withOverlap.clips, requested, 2_000)).toBe(4_000);
    const split = splitClip(withOverlap, CLIP_A_ID, 2_000, CLIP_C_ID, UPDATED_AT);
    expect(split.clips.filter(({ trackId }) => trackId === 'track-1')).toEqual([
      expect.objectContaining({ endMs: 2_000, fadeInMs: 1_000, fadeOutMs: 0 }),
      expect.objectContaining({
        startMs: 2_000,
        timelineStartMs: 2_000,
        fadeInMs: 0,
        fadeOutMs: 1_000,
      }),
    ]);
    expect(withOverlap.trackCount).toBe(2);
  });

  test('adds a complete source at the selected track end', () => {
    const project = makeProject();
    const first = addFullSourceClip(project, SOURCE_A_ID, CLIP_A_ID, 'track-2');
    const second = addFullSourceClip(first, SOURCE_A_ID, CLIP_B_ID, 'track-2');
    expect(first.clips[0]).toMatchObject({ trackId: 'track-2', timelineStartMs: 0 });
    expect(second.clips[1]).toMatchObject({ trackId: 'track-2', timelineStartMs: 60_000 });
  });

  test('trims edges within same-track gaps without rippling or consulting the other track', () => {
    const prior = makeClip({ id: CLIP_A_ID, startMs: 0, endMs: 1_000, timelineStartMs: 0 });
    const target = makeClip({
      id: CLIP_B_ID,
      startMs: 10_000,
      endMs: 14_000,
      timelineStartMs: 1_500,
    });
    const next = makeClip({
      id: CLIP_C_ID,
      startMs: 20_000,
      endMs: 21_000,
      timelineStartMs: 6_000,
    });
    const crossTrack = makeClip({
      id: CLIP_D_ID,
      startMs: 30_000,
      endMs: 38_000,
      trackId: 'track-2',
      timelineStartMs: 0,
    });
    const project = [prior, target, next, crossTrack].reduce(
      (current, clip) => addClip(current, clip),
      makeProject(),
    );

    const leftTrimmed = trimClipEdge(project, CLIP_B_ID, 'left', -1_000, UPDATED_AT);
    expect(leftTrimmed.clips.find(({ id }) => id === CLIP_B_ID)).toMatchObject({
      startMs: 9_500,
      endMs: 14_000,
      timelineStartMs: 1_000,
    });
    expect(
      leftTrimmed.clips
        .filter(({ id }) => id !== CLIP_B_ID)
        .map(({ id, startMs, endMs, timelineStartMs }) => ({
          id,
          startMs,
          endMs,
          timelineStartMs,
        })),
    ).toEqual(
      project.clips
        .filter(({ id }) => id !== CLIP_B_ID)
        .map(({ id, startMs, endMs, timelineStartMs }) => ({
          id,
          startMs,
          endMs,
          timelineStartMs,
        })),
    );
    expect(
      leftTrimmed.clips.find(({ id }) => id === CLIP_B_ID)!.timelineStartMs + (14_000 - 9_500),
    ).toBe(5_500);

    const rightTrimmed = trimClipEdge(project, CLIP_B_ID, 'right', 60_000, UPDATED_AT);
    expect(rightTrimmed.clips.find(({ id }) => id === CLIP_B_ID)).toMatchObject({
      startMs: 10_000,
      endMs: 14_500,
      timelineStartMs: 1_500,
    });
  });

  test('enforces integer and minimum trim bounds and auto-fits fixed fades dragged-edge first', () => {
    const faded = makeClip({
      startMs: 0,
      endMs: 4_000,
      timelineStartMs: 3_000,
      fadeInMs: 2_000,
      fadeOutMs: 2_000,
    });
    const project = addClip(makeProject(), faded);

    expect(trimClipEdge(project, CLIP_A_ID, 'left', 2_800).clips[0]).toMatchObject({
      startMs: 2_800,
      endMs: 4_000,
      timelineStartMs: 5_800,
      fadeInMs: 0,
      fadeOutMs: 1_000,
    });
    expect(trimClipEdge(project, CLIP_A_ID, 'right', 1_200).clips[0]).toMatchObject({
      startMs: 0,
      endMs: 1_200,
      timelineStartMs: 3_000,
      fadeInMs: 1_000,
      fadeOutMs: 0,
    });
    expect(trimClipEdge(project, CLIP_A_ID, 'left', 99_000).clips[0]).toMatchObject({
      startMs: 3_900,
      endMs: 4_000,
    });
    expect(trimClipEdge(project, CLIP_A_ID, 'right', 0).clips[0]).toMatchObject({
      startMs: 0,
      endMs: 100,
    });
    expect(() => trimClipEdge(project, CLIP_A_ID, 'left', 1.5)).toThrow(
      expect.objectContaining({ code: 'INVALID_TIMESTAMP' }),
    );
  });

  test('trim and split keep six-second fades on valid half-second steps', () => {
    const faded = makeClip({
      startMs: 0,
      endMs: 12_000,
      fadeInMs: 6_000,
      fadeOutMs: 6_000,
    });
    const project = addClip(makeProject(), faded);

    expect(trimClipEdge(project, CLIP_A_ID, 'left', 2_000).clips[0]).toMatchObject({
      startMs: 2_000,
      timelineStartMs: 2_000,
      fadeInMs: 4_000,
      fadeOutMs: 6_000,
    });
    expect(trimClipEdge(project, CLIP_A_ID, 'right', 10_000).clips[0]).toMatchObject({
      endMs: 10_000,
      fadeInMs: 6_000,
      fadeOutMs: 4_000,
    });
    expect(splitClip(project, CLIP_A_ID, 6_000, CLIP_B_ID).clips).toEqual([
      expect.objectContaining({ fadeInMs: 6_000, fadeOutMs: 0 }),
      expect.objectContaining({ fadeInMs: 0, fadeOutMs: 6_000 }),
    ]);
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
    makeClip({
      id: CLIP_B_ID,
      startMs: 10_000,
      endMs: 12_500,
      timelineStartMs: 1_000,
    }),
  ];

  test('builds contiguous prefix sums and total duration', () => {
    expect(buildClipTimeline(clips)).toEqual([
      {
        clipId: CLIP_A_ID,
        trackId: 'track-1',
        compositionStartMs: 0,
        compositionEndMs: 1_000,
      },
      {
        clipId: CLIP_B_ID,
        trackId: 'track-1',
        compositionStartMs: 1_000,
        compositionEndMs: 3_500,
      },
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

  test('maps both active clips when tracks overlap and includes silent gaps in duration', () => {
    const overlapping = [
      makeClip({ startMs: 0, endMs: 1_000, timelineStartMs: 2_000 }),
      makeClip({
        id: CLIP_B_ID,
        startMs: 10_000,
        endMs: 11_000,
        trackId: 'track-2',
        timelineStartMs: 2_500,
      }),
    ];
    expect(compositionDurationMs(overlapping)).toBe(3_500);
    expect(mapTimelinePositionToClips(overlapping, 2_750).map(({ clipId }) => clipId)).toEqual([
      CLIP_A_ID,
      CLIP_B_ID,
    ]);
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
