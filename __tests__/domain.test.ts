import {
  addClip,
  addSource,
  buildClipTimeline,
  compositionDurationMs,
  createProject,
  deleteClip,
  DomainError,
  immutableSourceMetadata,
  mapCompositionPosition,
  moveClipEarlier,
  moveClipLater,
  nextDefaultSourceName,
  parseSnapCutProject,
  removeUnusedSource,
  renameSource,
  reorderClip,
  snapCutClipSchema,
  snapCutProjectSchema,
  sourceFileSchema,
  sourceMetadataMatchesProjectSource,
  updateClip,
} from '@/domain';
import type { SnapCutClip, SnapCutProject, SnapCutSource } from '@/domain';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_A_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_B_ID = '33333333-3333-4333-8333-333333333333';
const CLIP_A_ID = '44444444-4444-4444-8444-444444444444';
const CLIP_B_ID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-08-14T12:00:00.000Z';

function source(overrides: Partial<SnapCutSource> = {}): SnapCutSource {
  return {
    id: SOURCE_A_ID,
    displayName: 'Source 1',
    originalMimeType: null,
    sourceKind: 'm4a',
    privateAudioFileName: 'source.m4a',
    durationMs: 30_000,
    codecMime: 'audio/mp4a-latm',
    sampleRateHz: 48_000,
    channelCount: 2,
    encodedBitrateBps: 256_000,
    pcmBitsPerSample: null,
    aacProfile: 'aac-lc',
    codecConfigFingerprint: 'a'.repeat(64),
    encoderDelayFrames: 0,
    encoderPaddingFrames: 0,
    privateAudioSha256: 'b'.repeat(64),
    fileSizeBytes: 1_024,
    waveformFileName: 'waveform.json',
    waveformStatus: 'pending',
    createdAt: NOW,
    ...overrides,
  };
}

function projectWithSources(): SnapCutProject {
  return addSource(
    addSource(createProject({ id: PROJECT_ID, name: 'Project', now: NOW }), source(), NOW),
    source({ id: SOURCE_B_ID, displayName: 'Source 2', durationMs: 20_000 }),
    NOW,
  );
}

function clip(overrides: Partial<SnapCutClip> = {}): SnapCutClip {
  return { id: CLIP_A_ID, sourceId: SOURCE_A_ID, startMs: 1_000, endMs: 4_000, ...overrides };
}

describe('v7 ordered clip domain', () => {
  it('creates only the v7 simple sequential shape', () => {
    const project = createProject({ id: PROJECT_ID, now: NOW });
    expect(project.schemaVersion).toBe(7);
    expect(project).not.toHaveProperty('trackCount');
    expect(snapCutProjectSchema.parse(project)).toEqual(project);
    expect(snapCutClipSchema.parse(clip())).toEqual(clip());
    expect(() => snapCutClipSchema.parse({ ...clip(), trackId: 'track-1' })).toThrow();
  });

  it('rejects every legacy schema instead of migrating it', () => {
    const current = createProject({ id: PROJECT_ID, name: 'Project', now: NOW });
    for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
      expect(() => parseSnapCutProject({ ...current, schemaVersion })).toThrow(
        'Legacy project metadata',
      );
    }
  });

  it('adds, updates, deletes, and validates source ranges', () => {
    const initial = projectWithSources();
    const added = addClip(initial, clip(), NOW);
    expect(added.clips).toEqual([clip()]);
    const updated = updateClip(
      added,
      CLIP_A_ID,
      { sourceId: SOURCE_B_ID, startMs: 250, endMs: 1_250 },
      NOW,
    );
    expect(updated.clips[0]).toMatchObject({ sourceId: SOURCE_B_ID, startMs: 250, endMs: 1_250 });
    expect(deleteClip(updated, CLIP_A_ID, NOW).clips).toEqual([]);
    expect(() => addClip(initial, clip({ endMs: 1_050 }), NOW)).toThrow(DomainError);
    expect(() => addClip(initial, clip({ endMs: 31_000 }), NOW)).toThrow(DomainError);
  });

  it('uses array order for duration, prefix sums, lookup, and reordering', () => {
    let project = projectWithSources();
    project = addClip(project, clip(), NOW);
    project = addClip(
      project,
      clip({ id: CLIP_B_ID, sourceId: SOURCE_B_ID, startMs: 500, endMs: 2_500 }),
      NOW,
    );
    expect(compositionDurationMs(project.clips)).toBe(5_000);
    expect(buildClipTimeline(project.clips)).toEqual([
      { clipId: CLIP_A_ID, compositionStartMs: 0, compositionEndMs: 3_000 },
      { clipId: CLIP_B_ID, compositionStartMs: 3_000, compositionEndMs: 5_000 },
    ]);
    expect(mapCompositionPosition(project.clips, 3_250)).toMatchObject({
      clipId: CLIP_B_ID,
      clipIndex: 1,
      positionInClipMs: 250,
      sourcePositionMs: 750,
    });
    expect(reorderClip(project, CLIP_B_ID, 0, NOW).clips.map(({ id }) => id)).toEqual([
      CLIP_B_ID,
      CLIP_A_ID,
    ]);
    expect(moveClipEarlier(project, CLIP_B_ID, NOW).clips[0]?.id).toBe(CLIP_B_ID);
    expect(moveClipLater(project, CLIP_A_ID, NOW).clips[1]?.id).toBe(CLIP_A_ID);
  });
});

describe('v7 source metadata', () => {
  it('allows duplicate Unicode names up to 255 code points', () => {
    const initial = projectWithSources();
    const unicodeName = '🎵'.repeat(255);
    const renamedA = renameSource(initial, SOURCE_A_ID, unicodeName, NOW);
    const renamedB = renameSource(renamedA, SOURCE_B_ID, unicodeName, NOW);
    expect(renamedB.sources.map(({ displayName }) => displayName)).toEqual([
      unicodeName,
      unicodeName,
    ]);
    expect(() => renameSource(initial, SOURCE_A_ID, '🎵'.repeat(256), NOW)).toThrow(DomainError);
  });

  it('generates a collision-safe Source N name', () => {
    expect(
      nextDefaultSourceName([
        source({ displayName: 'Source 2' }),
        source({ id: SOURCE_B_ID, displayName: 'Voice' }),
        source({ id: '66666666-6666-4666-8666-666666666666', displayName: 'Source 8' }),
      ]),
    ).toBe('Source 9');
  });

  it('keeps display name and waveform state out of immutable source.json', () => {
    const original = source();
    const manifest = sourceFileSchema.parse({
      schemaVersion: 2,
      projectId: PROJECT_ID,
      source: immutableSourceMetadata(original),
    });
    expect(manifest.source).not.toHaveProperty('displayName');
    expect(manifest.source).not.toHaveProperty('waveformFileName');
    expect(manifest.source).not.toHaveProperty('waveformStatus');
    expect(
      sourceMetadataMatchesProjectSource(manifest.source, {
        ...original,
        displayName: 'Renamed',
        waveformStatus: 'ready',
      }),
    ).toBe(true);
    expect(
      sourceMetadataMatchesProjectSource(manifest.source, { ...original, sampleRateHz: 44_100 }),
    ).toBe(false);
  });

  it('refuses to remove a referenced source', () => {
    const project = addClip(projectWithSources(), clip(), NOW);
    try {
      removeUnusedSource(project, SOURCE_A_ID, NOW);
      throw new Error('Expected SOURCE_IN_USE.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'SOURCE_IN_USE' });
    }
    expect(removeUnusedSource(project, SOURCE_B_ID, NOW).sources).toHaveLength(1);
  });
});
