import type { SnapCutProject, SnapCutSource } from '@/domain';
import { configureEditorServices, useEditorStore } from '@/stores';

const source = (
  id: string,
  durationMs: number,
  waveformStatus: 'pending' | 'ready' = 'pending',
): SnapCutSource => ({
  id,
  displayName: `${id}.m4a`,
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
});

const project = (sources: SnapCutSource[]): SnapCutProject => ({
  schemaVersion: 2,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Editor test',
  createdAt: '2026-08-12T20:00:00.000Z',
  updatedAt: '2026-08-12T20:00:00.000Z',
  sources,
  clips: [],
  lastExport: null,
});

describe('editor store', () => {
  beforeEach(() => {
    configureEditorServices({});
    useEditorStore.getState().reset();
  });

  it('selects the first source with the documented 30-second default', () => {
    const first = source('11111111-1111-4111-8111-111111111112', 95_000);
    useEditorStore.getState().syncProject(project([first]));

    expect(useEditorStore.getState()).toMatchObject({
      selectedSourceId: first.id,
      selectionStartMs: 0,
      selectionEndMs: 30_000,
      editingClipId: null,
      zoom: 1,
      viewportStartMs: 0,
    });
  });

  it('uses the full duration when a source is shorter than 30 seconds', () => {
    const short = source('11111111-1111-4111-8111-111111111113', 12_345);
    useEditorStore.getState().selectSource(project([]).id, short);
    expect(useEditorStore.getState().selectionEndMs).toBe(12_345);
  });

  it('keeps exact integer-ms boundaries valid while editing', () => {
    const selected = source('11111111-1111-4111-8111-111111111114', 10_000);
    const store = useEditorStore.getState();
    store.selectSource(project([]).id, selected);
    store.setSelectionEndMs(500, selected.durationMs);
    store.setSelectionStartMs(450, selected.durationMs);

    expect(useEditorStore.getState().selectionStartMs).toBe(400);
    expect(useEditorStore.getState().selectionEndMs).toBe(500);

    useEditorStore.getState().beginEditing(
      {
        id: '11111111-1111-4111-8111-111111111115',
        sourceId: selected.id,
        startMs: 123,
        endMs: 987,
      },
      selected,
    );
    expect(useEditorStore.getState()).toMatchObject({
      editingClipId: '11111111-1111-4111-8111-111111111115',
      selectionStartMs: 123,
      selectionEndMs: 987,
    });
  });

  it('bounds zoom to 1x–32x and viewport pan to source duration', () => {
    const selected = source('11111111-1111-4111-8111-111111111116', 32_000);
    useEditorStore.getState().selectSource(project([]).id, selected);

    useEditorStore.getState().setZoom(100, selected.durationMs);
    useEditorStore.getState().panViewport(100_000, selected.durationMs);
    expect(useEditorStore.getState().zoom).toBe(32);
    expect(useEditorStore.getState().viewportStartMs).toBe(31_000);

    useEditorStore.getState().setZoom(0, selected.durationMs);
    expect(useEditorStore.getState()).toMatchObject({ zoom: 1, viewportStartMs: 0 });
  });

  it('ignores a stale waveform result after selecting a newer source', async () => {
    const first = source('11111111-1111-4111-8111-111111111117', 30_000, 'ready');
    const second = source('11111111-1111-4111-8111-111111111118', 30_000, 'ready');
    const resolvers = new Map<string, (value: null) => void>();
    configureEditorServices({
      waveformReader: {
        loadWaveform: jest.fn(
          (_projectId: string, sourceId: string) =>
            new Promise<null>((resolve) => resolvers.set(sourceId, resolve)),
        ),
      },
    });

    useEditorStore.getState().selectSource(project([]).id, first);
    useEditorStore.getState().selectSource(project([]).id, second);
    resolvers.get(first.id)?.(null);
    await Promise.resolve();
    expect(useEditorStore.getState()).toMatchObject({
      selectedSourceId: second.id,
      waveformLoadState: 'loading',
    });

    resolvers.get(second.id)?.(null);
    await Promise.resolve();
    expect(useEditorStore.getState()).toMatchObject({
      selectedSourceId: second.id,
      waveformLoadState: 'unavailable',
    });
  });

  it('loads a waveform when a pending source becomes ready without re-entering the editor', async () => {
    const pending = source('11111111-1111-4111-8111-111111111119', 30_000, 'pending');
    const waveform = {
      schemaVersion: 1 as const,
      durationMs: pending.durationMs,
      binCount: 8192 as const,
      rms: Array.from({ length: 8192 }, () => 0.25),
      peak: Array.from({ length: 8192 }, () => 0.5),
    };
    const loadWaveform = jest.fn().mockResolvedValue(waveform);
    configureEditorServices({ waveformReader: { loadWaveform } });

    useEditorStore.getState().syncProject(project([pending]));
    expect(useEditorStore.getState().waveformLoadState).toBe('unavailable');

    useEditorStore.getState().syncProject(project([{ ...pending, waveformStatus: 'ready' }]));
    await waitForWaveformLoad();

    expect(loadWaveform).toHaveBeenCalledWith(project([]).id, pending.id);
    expect(useEditorStore.getState()).toMatchObject({
      waveformLoadState: 'ready',
      waveform,
    });
  });
});

async function waitForWaveformLoad(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (useEditorStore.getState().waveformLoadState !== 'loading') return;
    await Promise.resolve();
  }
  throw new Error('Waveform did not finish loading.');
}
