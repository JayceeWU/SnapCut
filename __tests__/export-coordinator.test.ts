import type { AppStateStatus } from 'react-native';

import type { ExportPreflightResult, SnapCutProject } from '@/domain';
import type {
  ExportAudioRequest,
  ExportAudioResult,
  NativeErrorEvent,
  NativeEventName,
  ProgressEvent,
} from '@/native';
import { ExportCoordinator, type ExportAppStatePort, type ExportMediaPort } from '@/services';
import { HeavyMediaTaskQueue } from '@/services/HeavyMediaTaskQueue';
import { useExportStore } from '@/stores';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '11111111-1111-4111-8111-111111111112';
const CLIP_ID = '11111111-1111-4111-8111-111111111113';
const HASH = 'a'.repeat(64);

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function project(): SnapCutProject {
  return {
    schemaVersion: 6,
    trackCount: 2,
    namePromptCompleted: true,
    id: PROJECT_ID,
    name: 'Purple rehearsal',
    createdAt: '2026-08-12T20:00:00.000Z',
    updatedAt: '2026-08-12T20:00:00.000Z',
    sources: [
      {
        id: SOURCE_ID,
        displayName: 'source.m4a',
        originalMimeType: 'audio/mp4',
        sourceKind: 'm4a',
        privateAudioFileName: 'source.m4a',
        durationMs: 10_000,
        codecMime: 'audio/mp4a-latm',
        sampleRateHz: 48_000,
        channelCount: 2,
        encodedBitrateBps: 192_000,
        pcmBitsPerSample: null,
        aacProfile: 'aac-lc',
        codecConfigFingerprint: HASH,
        encoderDelayFrames: null,
        encoderPaddingFrames: null,
        privateAudioSha256: HASH,
        fileSizeBytes: 100_000,
        waveformFileName: 'waveform.json',
        waveformStatus: 'ready',
        createdAt: '2026-08-12T20:00:00.000Z',
      },
    ],
    clips: [
      {
        id: CLIP_ID,
        sourceId: SOURCE_ID,
        startMs: 1_000,
        endMs: 5_000,
        trackId: 'track-1',
        timelineStartMs: 0,
        gain: 1,
        fadeInMs: 0,
        fadeOutMs: 0,
      },
    ],
    lastExport: null,
  };
}

function preflight(): ExportPreflightResult {
  return {
    preferredFormat: 'm4a',
    mayClip: false,
    m4aPlan: {
      planVersion: 1,
      planId: '11111111-1111-4111-8111-111111111114',
      createdAt: '2026-08-12T20:00:00.000Z',
      eligible: true,
      reasons: [],
      codecConfigFingerprint: HASH,
      sampleRateHz: 48_000,
      channelCount: 2,
      maxBoundaryAdjustmentMs: 0,
      estimatedOutputBytes: 80_000,
      sourceSnapshots: [
        {
          sourceId: SOURCE_ID,
          privateAudioSha256: HASH,
          codecConfigFingerprint: HASH,
          fileSizeBytes: 100_000,
          lastModifiedEpochMs: 1,
        },
      ],
      clips: [
        {
          clipId: CLIP_ID,
          sourceId: SOURCE_ID,
          requestedStartMs: 1_000,
          requestedEndMs: 5_000,
          effectiveStartUs: 1_000_000,
          effectiveEndUs: 5_000_000,
          startAdjustmentMs: 0,
          endAdjustmentMs: 0,
          estimatedEncodedBytes: 80_000,
        },
      ],
    },
    formats: [
      {
        format: 'm4a',
        mode: 'aac-stream-copy',
        available: true,
        reasons: [],
        estimatedOutputBytes: 80_000,
        requiredFreeBytes: 160_000,
        sampleRateHz: 48_000,
        channelCount: 2,
      },
      {
        format: 'flac',
        mode: 'flac-lossless-encode',
        available: true,
        reasons: [],
        estimatedOutputBytes: 800_000,
        requiredFreeBytes: 1_600_000,
        sampleRateHz: 48_000,
        channelCount: 2,
      },
      {
        format: 'mp3',
        mode: 'mp3-lossy-encode',
        available: true,
        reasons: [],
        estimatedOutputBytes: 160_000,
        requiredFreeBytes: 320_000,
        sampleRateHz: 48_000,
        channelCount: 2,
      },
    ],
  };
}

const exportResult: ExportAudioResult = {
  format: 'm4a',
  mode: 'aac-stream-copy',
  contentUri: 'content://media/audio/1',
  displayName: 'Purple rehearsal.m4a',
  requestedDurationMs: 4_000,
  actualDurationMs: 4_000,
  sampleRateHz: 48_000,
  channelCount: 2,
  bitrateKbps: null,
  bitsPerSample: null,
  maxBoundaryAdjustmentMs: 0,
  fileSizeBytes: 80_000,
};

class FakeAppState implements ExportAppStatePort {
  currentState: AppStateStatus = 'active';
  listener: ((state: AppStateStatus) => void) | null = null;

  addEventListener(_name: 'change', listener: (state: AppStateStatus) => void) {
    this.listener = listener;
    return { remove: () => (this.listener = null) };
  }

  emit(state: AppStateStatus) {
    this.currentState = state;
    this.listener?.(state);
  }
}

function bridge() {
  let progressListener: ((event: ProgressEvent) => void) | null = null;
  let errorListener: ((event: NativeErrorEvent) => void) | null = null;
  const preflightExport = jest.fn(async () => preflight());
  const cancelExportPreflight = jest.fn(async () => undefined);
  const exportAudio = jest.fn(async (_request: ExportAudioRequest) => exportResult);
  const cancelExport = jest.fn(async () => undefined);
  const shareExport = jest.fn(async () => undefined);
  const addEventListener = ((
    name: NativeEventName,
    listener: (event: ProgressEvent | NativeErrorEvent) => void,
  ) => {
    if (name === 'onExportProgress') progressListener = listener as (event: ProgressEvent) => void;
    if (name === 'onNativeError') errorListener = listener as (event: NativeErrorEvent) => void;
    return { remove: () => undefined };
  }) as ExportMediaPort['addEventListener'];
  const media: ExportMediaPort = {
    preflightExport,
    cancelExportPreflight,
    exportAudio,
    cancelExport,
    shareExport,
    addEventListener,
  };
  return {
    media,
    preflightExport,
    cancelExportPreflight,
    exportAudio,
    cancelExport,
    emitProgress: (event: ProgressEvent) => progressListener?.(event),
    emitError: (event: NativeErrorEvent) => errorListener?.(event),
  };
}

describe('ExportCoordinator', () => {
  beforeEach(() => useExportStore.getState().reset());

  it('preflights committed clips and exports the immutable M4A plan', async () => {
    const native = bridge();
    const releaseProject = jest.fn(async () => undefined);
    const ids = ['preflight-job', 'export-job'];
    const coordinator = new ExportCoordinator({
      media: native.media,
      sourceResolver: {
        resolveSourceAudioUri: (_project, source) => `file:///private/${source.id}/source.m4a`,
      },
      preview: { releaseProject },
      appState: new FakeAppState(),
      idFactory: () => ids.shift()!,
      now: () => new Date('2026-08-12T21:00:00.000Z'),
    });

    await coordinator.prepare(project());
    expect(native.preflightExport).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'preflight-job',
        generation: 1,
        clips: [
          expect.objectContaining({ audioFileUri: `file:///private/${SOURCE_ID}/source.m4a` }),
        ],
      }),
    );
    expect(useExportStore.getState()).toMatchObject({
      status: 'ready',
      selectedFormat: 'm4a',
    });

    const record = await coordinator.export(project());
    expect(native.exportAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'export-job',
        generation: 2,
        format: 'm4a',
        outputSampleRateHz: null,
        outputChannelCount: null,
        m4aPlan: preflight().m4aPlan,
      }),
    );
    expect(record).toEqual({ ...exportResult, exportedAt: '2026-08-12T21:00:00.000Z' });
    expect(releaseProject).toHaveBeenCalledTimes(2);
  });

  it('uses monotonic matching progress and cancels active export on background', async () => {
    const native = bridge();
    let resolveExport!: (result: ExportAudioResult) => void;
    native.exportAudio.mockImplementation(
      () => new Promise((resolve) => (resolveExport = resolve)),
    );
    const appState = new FakeAppState();
    const ids = ['preflight-job', 'export-job'];
    const coordinator = new ExportCoordinator({
      media: native.media,
      sourceResolver: { resolveSourceAudioUri: () => 'file:///private/source.m4a' },
      preview: { releaseProject: async () => undefined },
      appState,
      idFactory: () => ids.shift()!,
    });

    await coordinator.prepare(project());
    const pending = coordinator.export(project()).catch(() => undefined);
    await flushTasks();
    native.emitProgress({
      jobId: 'export-job',
      operation: 'export',
      sequence: 2,
      stage: 'Encoding',
      generation: 2,
      fraction: 0.5,
      format: 'm4a',
    });
    native.emitProgress({
      jobId: 'export-job',
      operation: 'export',
      sequence: 1,
      stage: 'Stale',
      generation: 2,
      fraction: 0.1,
      format: 'm4a',
    });
    expect(useExportStore.getState()).toMatchObject({ stage: 'Encoding', progress: 0.5 });

    appState.emit('background');
    await Promise.resolve();
    expect(native.cancelExport).toHaveBeenCalledWith('export-job');
    resolveExport(exportResult);
    await pending;
    expect(useExportStore.getState().status).toBe('failed');
  });

  it('uses the absolute timeline end instead of summing clip durations', async () => {
    const native = bridge();
    const timelineProject = project();
    timelineProject.clips = [
      timelineProject.clips[0]!,
      {
        ...timelineProject.clips[0]!,
        id: '11111111-1111-4111-8111-111111111116',
        timelineStartMs: 7_000,
      },
    ];
    const coordinator = new ExportCoordinator({
      media: native.media,
      sourceResolver: { resolveSourceAudioUri: () => 'file:///private/source.m4a' },
      preview: { releaseProject: async () => undefined },
      appState: new FakeAppState(),
      idFactory: () => 'timeline-preflight',
    });

    await coordinator.prepare(timelineProject);
    expect(useExportStore.getState().compositionDurationMs).toBe(11_000);
  });

  it('waits behind other heavy media work and does not start a cancelled queued preflight', async () => {
    const native = bridge();
    const queue = new HeavyMediaTaskQueue();
    let releaseBlocker!: () => void;
    const blocker = queue.enqueue(
      { operation: 'waveform', jobId: 'waveform-job' },
      () => new Promise<void>((resolve) => (releaseBlocker = resolve)),
    );
    await flushTasks();
    const coordinator = new ExportCoordinator({
      media: native.media,
      sourceResolver: { resolveSourceAudioUri: () => 'file:///private/source.m4a' },
      preview: { releaseProject: async () => undefined },
      appState: new FakeAppState(),
      idFactory: () => 'queued-preflight',
      queue,
    });

    const pending = coordinator.prepare(project());
    await flushTasks();
    expect(native.preflightExport).not.toHaveBeenCalled();
    await coordinator.cancel();
    expect(native.cancelExportPreflight).toHaveBeenCalledWith('queued-preflight');
    releaseBlocker();
    await blocker;
    await pending;
    expect(native.preflightExport).not.toHaveBeenCalled();
  });

  it('records a stable native export error code and safe operation identifiers', async () => {
    const native = bridge();
    let resolveExport!: (result: ExportAudioResult) => void;
    native.exportAudio.mockImplementation(
      () => new Promise((resolve) => (resolveExport = resolve)),
    );
    const onDiagnostic = jest.fn();
    const ids = ['preflight-job', 'export-job'];
    const coordinator = new ExportCoordinator({
      media: native.media,
      sourceResolver: { resolveSourceAudioUri: () => 'file:///private/source.m4a' },
      preview: { releaseProject: async () => undefined },
      appState: new FakeAppState(),
      idFactory: () => ids.shift()!,
      onDiagnostic,
    });

    await coordinator.prepare(project());
    const pending = coordinator.export(project());
    await flushTasks();
    native.emitError({
      jobId: 'export-job',
      operation: 'export',
      sequence: 1,
      stage: 'encoding',
      generation: 2,
      code: 'M4A_MUX_FAILED',
      message: 'private native detail',
      format: 'm4a',
    });
    resolveExport(exportResult);
    await pending;

    expect(onDiagnostic).toHaveBeenCalledWith({
      operation: 'export',
      projectId: PROJECT_ID,
      jobId: 'export-job',
      generation: 2,
      stage: 'encoding',
      code: 'M4A_MUX_FAILED',
    });
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('private native detail');
  });
});
