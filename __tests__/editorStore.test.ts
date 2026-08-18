import type { SnapCutClip, SnapCutProject, SnapCutSource, WaveformFile } from '@/domain';
import { configureEditorServices, useEditorStore } from '@/stores';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_A_ID = '11111111-1111-4111-8111-111111111112';
const SOURCE_B_ID = '11111111-1111-4111-8111-111111111113';
const CLIP_ID = '11111111-1111-4111-8111-111111111114';

function source(
  id: string,
  durationMs = 30_000,
  waveformStatus: SnapCutSource['waveformStatus'] = 'pending',
): SnapCutSource {
  return {
    id,
    displayName: id === SOURCE_A_ID ? 'Voice' : 'Music',
    originalMimeType: 'audio/mp4',
    sourceKind: 'm4a',
    privateAudioFileName: 'source.m4a',
    durationMs,
    codecMime: 'audio/mp4a-latm',
    sampleRateHz: 48_000,
    channelCount: 2,
    encodedBitrateBps: 192_000,
    pcmBitsPerSample: null,
    aacProfile: 'aac-lc',
    codecConfigFingerprint: null,
    encoderDelayFrames: null,
    encoderPaddingFrames: null,
    privateAudioSha256: null,
    fileSizeBytes: 1_024,
    waveformFileName: 'waveform.json',
    waveformStatus,
    createdAt: '2026-08-12T20:00:00.000Z',
  };
}

function project(
  sources: SnapCutSource[],
  clips: SnapCutClip[] = [],
  id = PROJECT_ID,
): SnapCutProject {
  return {
    schemaVersion: 9,
    crossfades: [],
    sourceComparisons: [],
    namePromptCompleted: true,
    id,
    name: 'Editor test',
    createdAt: '2026-08-12T20:00:00.000Z',
    updatedAt: '2026-08-12T20:00:00.000Z',
    sources,
    clips,
    lastExport: null,
  };
}

function waveform(durationMs: number): WaveformFile {
  return {
    schemaVersion: 1,
    durationMs,
    binCount: 8192,
    rms: Array.from({ length: 8192 }, () => 0.25),
    peak: Array.from({ length: 8192 }, () => 0.5),
  };
}

async function flushWaveforms(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!Object.values(useEditorStore.getState().waveformLoadStatesBySourceId).includes('loading'))
      return;
    await Promise.resolve();
  }
  throw new Error('Waveform load did not settle.');
}

describe('editor store', () => {
  beforeEach(() => {
    configureEditorServices({});
    useEditorStore.getState().reset();
  });

  it('tracks only the sequential cursor and clamps it to summed clip duration', () => {
    const media = source(SOURCE_A_ID);
    const clip: SnapCutClip = {
      id: CLIP_ID,
      sourceId: media.id,
      startMs: 1_000,
      endMs: 3_500,
    };
    useEditorStore.getState().syncProject(project([media], [clip]));
    useEditorStore.getState().setTimelineCursorMs(9_999, 2_500);

    expect(useEditorStore.getState()).toMatchObject({
      projectId: PROJECT_ID,
      timelineCursorMs: 2_500,
    });
    expect(useEditorStore.getState()).not.toHaveProperty('selectedTrackId');
    expect(useEditorStore.getState()).not.toHaveProperty('zoom');
  });

  it('keeps an edited clip only while it remains in the active project', () => {
    const media = source(SOURCE_A_ID);
    const clip: SnapCutClip = { id: CLIP_ID, sourceId: media.id, startMs: 0, endMs: 1_000 };
    useEditorStore.getState().syncProject(project([media], [clip]));
    useEditorStore.getState().beginEditing(clip.id);
    useEditorStore.getState().syncProject(project([media], [clip]));
    expect(useEditorStore.getState().editingClipId).toBe(clip.id);

    useEditorStore.getState().syncProject(project([media], []));
    expect(useEditorStore.getState().editingClipId).toBeNull();
  });

  it('loads every ready source waveform for composition slicing', async () => {
    const first = source(SOURCE_A_ID, 30_000, 'ready');
    const second = source(SOURCE_B_ID, 20_000, 'ready');
    const loadWaveform = jest.fn((_projectId: string, sourceId: string) =>
      Promise.resolve(waveform(sourceId === first.id ? first.durationMs : second.durationMs)),
    );
    configureEditorServices({ waveformReader: { loadWaveform } });

    useEditorStore.getState().syncProject(project([first, second]));
    await flushWaveforms();

    expect(loadWaveform).toHaveBeenCalledTimes(2);
    expect(useEditorStore.getState()).toMatchObject({
      waveformLoadStatesBySourceId: {
        [first.id]: 'ready',
        [second.id]: 'ready',
      },
    });
    expect(useEditorStore.getState().waveformsBySourceId[first.id]).toEqual(
      waveform(first.durationMs),
    );
  });

  it('loads a waveform when a pending source becomes ready without reopening the editor', async () => {
    const pending = source(SOURCE_A_ID, 30_000, 'pending');
    const loadWaveform = jest.fn().mockResolvedValue(waveform(pending.durationMs));
    configureEditorServices({ waveformReader: { loadWaveform } });

    useEditorStore.getState().syncProject(project([pending]));
    expect(useEditorStore.getState().waveformLoadStatesBySourceId[pending.id]).toBe('unavailable');

    useEditorStore.getState().syncProject(project([{ ...pending, waveformStatus: 'ready' }]));
    await flushWaveforms();

    expect(loadWaveform).toHaveBeenCalledWith(PROJECT_ID, pending.id);
    expect(useEditorStore.getState().waveformLoadStatesBySourceId[pending.id]).toBe('ready');
  });

  it('discards waveform results from a project that is no longer active', async () => {
    const ready = source(SOURCE_A_ID, 30_000, 'ready');
    let resolveWaveform!: (value: WaveformFile) => void;
    configureEditorServices({
      waveformReader: {
        loadWaveform: jest.fn(
          () =>
            new Promise<WaveformFile>((resolve) => {
              resolveWaveform = resolve;
            }),
        ),
      },
    });
    useEditorStore.getState().syncProject(project([ready]));
    useEditorStore.getState().syncProject(project([], [], '22222222-2222-4222-8222-222222222222'));
    resolveWaveform(waveform(ready.durationMs));
    await Promise.resolve();

    expect(useEditorStore.getState()).toMatchObject({
      projectId: '22222222-2222-4222-8222-222222222222',
      waveformsBySourceId: {},
    });
  });
});
