import {
  addClip,
  addCrossfade,
  addSource,
  appendSourceComparisonClips,
  buildClipTimeline,
  compositionDurationMs,
  createDefaultExportBaseName,
  createProject,
  deleteClip,
  deleteCrossfade,
  DomainError,
  immutableSourceMetadata,
  mapCompositionPosition,
  moveCrossfade,
  nextDefaultSourceName,
  removeUnusedSource,
  renameSource,
  reorderClip,
  setSourceComparisonBookmark,
  snapCutClipSchema,
  snapCutProjectSchema,
  sourceFileSchema,
  sourceMetadataMatchesProjectSource,
  updateClip,
  updateCrossfadeDuration,
} from '@/domain';
import type { SnapCutClip, SnapCutProject, SnapCutSource } from '@/domain';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_A_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_B_ID = '33333333-3333-4333-8333-333333333333';
const CLIP_A_ID = '44444444-4444-4444-8444-444444444444';
const CLIP_B_ID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-08-14T12:00:00.000Z';

describe('export naming', () => {
  const localDate = new Date(2026, 7, 15, 14, 29, 48);

  it('uses a named project verbatim without appending a timestamp', () => {
    expect(createDefaultExportBaseName('月亮代表我的心2', localDate)).toBe('月亮代表我的心2');
  });

  it('keeps an automatically generated time project name unchanged', () => {
    expect(createDefaultExportBaseName('2026-08-15 14-29-48', localDate)).toBe(
      '2026-08-15 14-29-48',
    );
  });

  it('uses a local time project name only when the name is blank', () => {
    expect(createDefaultExportBaseName('   ', localDate)).toBe('2026-08-15 14-29-48');
  });

  it('replaces Android-unsafe filename characters and managed extensions', () => {
    expect(createDefaultExportBaseName('Mix/Take:1?.m4a', localDate)).toBe('Mix-Take-1--m4a');
  });
});

function source(overrides: Partial<SnapCutSource> = {}): SnapCutSource {
  return {
    id: SOURCE_A_ID,
    displayName: 'S1',
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
    source({ id: SOURCE_B_ID, displayName: 'S2', durationMs: 20_000 }),
    NOW,
  );
}

function clip(overrides: Partial<SnapCutClip> = {}): SnapCutClip {
  return { id: CLIP_A_ID, sourceId: SOURCE_A_ID, startMs: 1_000, endMs: 4_000, ...overrides };
}

describe('v9 ordered clip domain', () => {
  it('creates the v9 sequential shape with comparison and crossfade records', () => {
    const project = createProject({ id: PROJECT_ID, now: NOW });
    expect(project.schemaVersion).toBe(9);
    expect(project.sourceComparisons).toEqual([]);
    expect(project.crossfades).toEqual([]);
    expect(project).not.toHaveProperty('trackCount');
    expect(snapCutProjectSchema.parse(project)).toEqual(project);
    expect(snapCutClipSchema.parse(clip())).toEqual(clip());
    expect(() => snapCutClipSchema.parse({ ...clip(), trackId: 'track-1' })).toThrow();
  });

  it('accepts only the current project schema', () => {
    const current = createProject({ id: PROJECT_ID, name: 'Project', now: NOW });
    expect(snapCutProjectSchema.parse(current)).toEqual(current);
    expect(() => snapCutProjectSchema.parse({ ...current, schemaVersion: 8 })).toThrow();
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
  });
});

describe('v9 crossfades', () => {
  function projectWithCrossfadeHandles(): SnapCutProject {
    let project = projectWithSources();
    project = addClip(project, clip({ startMs: 1_000, endMs: 10_000 }), NOW);
    project = addClip(
      project,
      clip({ id: CLIP_B_ID, sourceId: SOURCE_B_ID, startMs: 5_000, endMs: 15_000 }),
      NOW,
    );
    return project;
  }

  it('adds, updates, moves, and deletes supported equal-power boundaries', () => {
    let project = projectWithCrossfadeHandles();
    project = addClip(
      project,
      clip({
        id: '66666666-6666-4666-8666-666666666666',
        sourceId: SOURCE_A_ID,
        startMs: 4_000,
        endMs: 12_000,
      }),
      NOW,
    );
    project = addCrossfade(
      project,
      {
        id: '77777777-7777-4777-8777-777777777777',
        leftClipId: CLIP_A_ID,
        rightClipId: CLIP_B_ID,
        durationMs: 2_000,
      },
      NOW,
    );
    expect(project.crossfades[0]?.durationMs).toBe(2_000);
    project = updateCrossfadeDuration(project, project.crossfades[0]!.id, 4_000, NOW);
    expect(project.crossfades[0]?.durationMs).toBe(4_000);
    project = moveCrossfade(
      project,
      project.crossfades[0]!.id,
      CLIP_B_ID,
      '66666666-6666-4666-8666-666666666666',
      NOW,
    );
    expect(project.crossfades[0]).toMatchObject({ leftClipId: CLIP_B_ID, durationMs: 4_000 });
    expect(deleteCrossfade(project, project.crossfades[0]!.id, NOW).crossfades).toEqual([]);
  });

  it('rejects insufficient source handles and overlapping fades inside one clip', () => {
    const project = projectWithCrossfadeHandles();
    const withoutExitHandle = updateClip(project, CLIP_A_ID, { endMs: 29_000 }, NOW);
    expect(() =>
      addCrossfade(
        withoutExitHandle,
        {
          id: '77777777-7777-4777-8777-777777777777',
          leftClipId: CLIP_A_ID,
          rightClipId: CLIP_B_ID,
          durationMs: 8_000,
        },
        NOW,
      ),
    ).toThrow(DomainError);
    const first = addCrossfade(
      project,
      {
        id: '77777777-7777-4777-8777-777777777777',
        leftClipId: CLIP_A_ID,
        rightClipId: CLIP_B_ID,
        durationMs: 2_000,
      },
      NOW,
    );
    expect(() => updateClip(first, CLIP_B_ID, { startMs: 0, endMs: 500 }, NOW)).toThrow();
  });

  it('removes a boundary automatically when clip reordering breaks adjacency', () => {
    let project = projectWithCrossfadeHandles();
    project = addClip(
      project,
      clip({
        id: '66666666-6666-4666-8666-666666666666',
        sourceId: SOURCE_A_ID,
        startMs: 4_000,
        endMs: 12_000,
      }),
      NOW,
    );
    project = addCrossfade(
      project,
      {
        id: '77777777-7777-4777-8777-777777777777',
        leftClipId: CLIP_A_ID,
        rightClipId: CLIP_B_ID,
        durationMs: 2_000,
      },
      NOW,
    );
    expect(reorderClip(project, CLIP_A_ID, 2, NOW).crossfades).toEqual([]);
  });
});

describe('source comparison bookmarks', () => {
  it('sets and overwrites one valid bookmark per source', () => {
    const initial = projectWithSources();
    const first = setSourceComparisonBookmark(initial, SOURCE_A_ID, 8_000, 18_000, NOW);
    const overwritten = setSourceComparisonBookmark(first, SOURCE_A_ID, 9_000, 19_000, NOW);
    expect(overwritten.sourceComparisons).toEqual([
      { sourceId: SOURCE_A_ID, firstMs: 9_000, secondMs: 19_000 },
    ]);
    expect(() => setSourceComparisonBookmark(initial, SOURCE_A_ID, 0, 18_000, NOW)).toThrow();
    expect(() => setSourceComparisonBookmark(initial, SOURCE_A_ID, 18_000, 18_000, NOW)).toThrow();
    expect(() => setSourceComparisonBookmark(initial, SOURCE_A_ID, 8_000, 29_950, NOW)).toThrow();
  });

  it('atomically appends both kept ranges after existing clips', () => {
    let project = addClip(projectWithSources(), clip(), NOW);
    project = setSourceComparisonBookmark(project, SOURCE_A_ID, 8_000, 18_000, NOW);
    const added = appendSourceComparisonClips(
      project,
      SOURCE_A_ID,
      CLIP_B_ID,
      '66666666-6666-4666-8666-666666666666',
      NOW,
    );
    expect(added.clips).toEqual([
      clip(),
      { id: CLIP_B_ID, sourceId: SOURCE_A_ID, startMs: 0, endMs: 8_000 },
      {
        id: '66666666-6666-4666-8666-666666666666',
        sourceId: SOURCE_A_ID,
        startMs: 18_000,
        endMs: 30_000,
      },
    ]);
    expect(project.clips).toHaveLength(1);
  });
});

describe('source metadata', () => {
  it('allows duplicate Unicode names up to 6 code points', () => {
    const initial = projectWithSources();
    const unicodeName = '🎵'.repeat(6);
    const renamedA = renameSource(initial, SOURCE_A_ID, unicodeName, NOW);
    const renamedB = renameSource(renamedA, SOURCE_B_ID, unicodeName, NOW);
    expect(renamedB.sources.map(({ displayName }) => displayName)).toEqual([
      unicodeName,
      unicodeName,
    ]);
    expect(() => renameSource(initial, SOURCE_A_ID, '🎵'.repeat(7), NOW)).toThrow(DomainError);
  });

  it('generates a collision-safe compact source name', () => {
    expect(
      nextDefaultSourceName([
        source({ displayName: 'S2' }),
        source({ id: SOURCE_B_ID, displayName: 'Voice' }),
        source({ id: '66666666-6666-4666-8666-666666666666', displayName: 'S8' }),
      ]),
    ).toBe('S9');
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
        displayName: 'New',
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
    const withBookmark = setSourceComparisonBookmark(project, SOURCE_B_ID, 5_000, 10_000, NOW);
    const removed = removeUnusedSource(withBookmark, SOURCE_B_ID, NOW);
    expect(removed.sources).toHaveLength(1);
    expect(removed.sourceComparisons).toEqual([]);
  });
});
