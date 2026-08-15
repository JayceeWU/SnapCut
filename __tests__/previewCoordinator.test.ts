import type { AppStateStatus } from 'react-native';

import type { SnapCutClip, SnapCutProject, SnapCutSource } from '@/domain';
import type {
  LoadPreviewRequest,
  NativeErrorEvent,
  NativeEventName,
  PlaybackStatusEvent,
  PreviewCommandRequest,
} from '@/native';
import {
  PreviewCoordinator,
  type CommittedSourceResolverPort,
  type PreviewAppStatePort,
  type PreviewMediaPort,
} from '@/services';
import { usePlaybackStore } from '@/stores';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_A_ID = '11111111-1111-4111-8111-111111111112';
const SOURCE_B_ID = '11111111-1111-4111-8111-111111111113';
const CLIP_A_ID = '11111111-1111-4111-8111-111111111114';
const CLIP_B_ID = '11111111-1111-4111-8111-111111111115';

function source(id: string, displayName: string): SnapCutSource {
  return {
    id,
    displayName,
    originalMimeType: 'audio/mp4',
    sourceKind: 'm4a',
    privateAudioFileName: 'source.m4a',
    durationMs: 20_000,
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
    waveformStatus: 'ready',
    createdAt: '2026-08-12T20:00:00.000Z',
  };
}

const clipA: SnapCutClip = {
  id: CLIP_A_ID,
  sourceId: SOURCE_A_ID,
  startMs: 1_000,
  endMs: 4_000,
  trackId: 'track-1',
  timelineStartMs: 0,
  gain: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
};
const clipB: SnapCutClip = {
  id: CLIP_B_ID,
  sourceId: SOURCE_B_ID,
  startMs: 2_000,
  endMs: 7_000,
  trackId: 'track-1',
  timelineStartMs: 3_000,
  gain: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
};

function project(): SnapCutProject {
  return {
    schemaVersion: 6,
    trackCount: 2,
    namePromptCompleted: true,
    id: PROJECT_ID,
    name: 'Preview',
    createdAt: '2026-08-12T20:00:00.000Z',
    updatedAt: '2026-08-12T20:00:00.000Z',
    sources: [source(SOURCE_A_ID, 'a.m4a'), source(SOURCE_B_ID, 'b.m4a')],
    clips: [clipA, clipB],
    lastExport: null,
  };
}

class FakeAppState implements PreviewAppStatePort {
  currentState: AppStateStatus = 'active';
  private listener: ((state: AppStateStatus) => void) | null = null;

  addEventListener(_eventName: 'change', listener: (state: AppStateStatus) => void) {
    this.listener = listener;
    return {
      remove: () => {
        this.listener = null;
      },
    };
  }

  emit(state: AppStateStatus): void {
    this.currentState = state;
    this.listener?.(state);
  }
}

function createMediaBridge() {
  let playbackListener: ((event: PlaybackStatusEvent) => void) | null = null;
  let errorListener: ((event: NativeErrorEvent) => void) | null = null;
  const loadSelectionPreview = jest.fn(async (_request: LoadPreviewRequest) => undefined);
  const loadCompositionPreview = jest.fn(async (_request: LoadPreviewRequest) => undefined);
  const playPreview = jest.fn(async (_request: PreviewCommandRequest) => undefined);
  const pausePreview = jest.fn(async (_request: PreviewCommandRequest) => undefined);
  const seekPreview = jest.fn(async () => undefined);
  const releasePreview = jest.fn(async () => undefined);
  const addEventListener = ((
    eventName: NativeEventName,
    listener: (event: PlaybackStatusEvent | NativeErrorEvent) => void,
  ) => {
    if (eventName === 'onPlaybackStatus') {
      playbackListener = listener as (event: PlaybackStatusEvent) => void;
    } else if (eventName === 'onNativeError') {
      errorListener = listener as (event: NativeErrorEvent) => void;
    }
    return { remove: () => undefined };
  }) as PreviewMediaPort['addEventListener'];

  const media: PreviewMediaPort = {
    getHealth: () => ({
      moduleName: 'SnapCutMedia',
      moduleVersion: '1.0.0',
      platform: 'android',
      ready: true,
      mediaPipelineAvailable: true,
    }),
    getCodecBuildInfo: () => ({
      moduleVersion: '1.0.0',
      media3: { version: '1.10.1', available: true },
      flac: { version: null, available: false },
      lame: { version: null, available: false },
      libsamplerate: { version: null, available: false },
      nativeCodecBridgeLoaded: false,
    }),
    loadSelectionPreview,
    loadCompositionPreview,
    playPreview,
    pausePreview,
    seekPreview,
    releasePreview,
    addEventListener,
  };

  return {
    media,
    loadSelectionPreview,
    loadCompositionPreview,
    playPreview,
    pausePreview,
    seekPreview,
    releasePreview,
    emitStatus: (event: PlaybackStatusEvent) => playbackListener?.(event),
    emitError: (event: NativeErrorEvent) => errorListener?.(event),
  };
}

const resolver: CommittedSourceResolverPort = {
  resolveSourceAudioUri: (previewProject, previewSource) =>
    `file:///private/projects/${previewProject.id}/sources/${previewSource.id}/source.m4a`,
};

function status(overrides: Partial<PlaybackStatusEvent> = {}): PlaybackStatusEvent {
  return {
    jobId: 'session-1',
    operation: 'preview',
    sequence: 1,
    stage: 'ready',
    generation: 1,
    controlRevision: 0,
    playbackSessionId: 'session-1',
    mode: 'selection',
    loaded: true,
    playing: false,
    positionMs: 0,
    durationMs: 3_000,
    currentClipIndex: 0,
    currentClipId: CLIP_A_ID,
    didJustFinish: false,
    ...overrides,
  };
}

function coordinator(
  bridge: ReturnType<typeof createMediaBridge>,
  appState = new FakeAppState(),
  onDiagnostic = jest.fn(),
) {
  const preview = new PreviewCoordinator({
    media: bridge.media,
    sourceResolver: resolver,
    appState,
    idFactory: () => 'session-1',
    onDiagnostic,
  });
  preview.start();
  return preview;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('PreviewCoordinator', () => {
  beforeEach(() => usePlaybackStore.getState().reset());

  it('loads one committed private selection with a session and generation', async () => {
    const bridge = createMediaBridge();
    const preview = coordinator(bridge);

    await expect(preview.loadSelection(project(), clipA)).resolves.toBe(true);
    expect(bridge.loadSelectionPreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 0,
      clips: [
        {
          clipId: CLIP_A_ID,
          sourceId: SOURCE_A_ID,
          audioFileUri: `file:///private/projects/${PROJECT_ID}/sources/${SOURCE_A_ID}/source.m4a`,
          startMs: 1_000,
          endMs: 4_000,
          trackId: 'track-1',
          timelineStartMs: 0,
          gain: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
        },
      ],
    });
    expect(usePlaybackStore.getState()).toMatchObject({
      projectId: PROJECT_ID,
      playbackSessionId: 'session-1',
      generation: 1,
      mode: 'selection',
      loading: true,
      loaded: false,
    });
  });

  it('uses a stable source identity so a second media preview press pauses', async () => {
    const bridge = createMediaBridge();
    const preview = coordinator(bridge);
    const previewProject = project();
    const previewSource = previewProject.sources[0]!;

    await preview.toggleSource(previewProject, previewSource);
    expect(bridge.loadSelectionPreview).toHaveBeenCalledTimes(1);
    expect(bridge.loadSelectionPreview.mock.calls[0]?.[0].clips[0]).toMatchObject({
      clipId: SOURCE_A_ID,
      sourceId: SOURCE_A_ID,
      startMs: 0,
      endMs: 20_000,
    });

    bridge.emitStatus(
      status({
        currentClipId: SOURCE_A_ID,
        durationMs: 20_000,
        playing: true,
        sequence: 2,
        controlRevision: 1,
      }),
    );
    await preview.toggleSource(previewProject, previewSource);

    expect(bridge.loadSelectionPreview).toHaveBeenCalledTimes(1);
    expect(bridge.pausePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 2,
    });
  });

  it('loads a composition and starts from the editor cursor', async () => {
    const bridge = createMediaBridge();
    const preview = coordinator(bridge);

    await preview.toggleComposition(project(), 5_500);

    expect(bridge.loadCompositionPreview).toHaveBeenCalledTimes(1);
    expect(bridge.seekPreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 1,
      positionMs: 5_500,
      resumeAfterSeek: false,
    });
    expect(bridge.playPreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 1,
    });
  });

  it('pauses optimistically during load and prevents the stale play continuation', async () => {
    const bridge = createMediaBridge();
    const loading = deferred<undefined>();
    bridge.loadCompositionPreview.mockImplementationOnce(() => loading.promise);
    const preview = coordinator(bridge);

    const playPromise = preview.playComposition(project(), 1_000);
    await Promise.resolve();
    expect(usePlaybackStore.getState()).toMatchObject({
      loading: true,
      desiredPlaying: true,
      controlRevision: 1,
    });

    const pausePromise = preview.pauseComposition();
    expect(usePlaybackStore.getState()).toMatchObject({
      playing: false,
      desiredPlaying: false,
      pausePending: true,
      controlRevision: 2,
      positionMs: 0,
    });
    expect(bridge.pausePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 2,
    });

    loading.resolve(undefined);
    await Promise.all([playPromise, pausePromise]);
    expect(bridge.playPreview).not.toHaveBeenCalled();
    expect(bridge.seekPreview).not.toHaveBeenCalled();

    bridge.emitStatus(
      status({
        mode: 'composition',
        sequence: 2,
        controlRevision: 1,
        playing: true,
        positionMs: 900,
      }),
    );
    expect(usePlaybackStore.getState()).toMatchObject({ playing: false, positionMs: 0 });

    bridge.emitStatus(
      status({
        mode: 'composition',
        sequence: 3,
        controlRevision: 2,
        playing: false,
        positionMs: 25,
      }),
    );
    expect(usePlaybackStore.getState()).toMatchObject({
      playing: false,
      desiredPlaying: false,
      pausePending: false,
      positionMs: 25,
    });
  });

  it('invalidates a rejected load after a newer pause without replacing paused UI with an error', async () => {
    const bridge = createMediaBridge();
    const onDiagnostic = jest.fn();
    const loading = deferred<undefined>();
    bridge.loadCompositionPreview.mockImplementationOnce(() => loading.promise);
    const preview = coordinator(bridge, new FakeAppState(), onDiagnostic);

    const playPromise = preview.playComposition(project(), 1_000);
    await Promise.resolve();
    await preview.pauseComposition();
    loading.reject(new Error('late load failure'));
    await playPromise;

    expect(bridge.releasePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 2,
    });
    expect(bridge.playPreview).not.toHaveBeenCalled();
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(usePlaybackStore.getState()).toMatchObject({
      loading: false,
      loaded: false,
      playing: false,
      desiredPlaying: false,
      pausePending: false,
      positionMs: 0,
      error: null,
    });
  });

  it('surfaces a rejected load when the latest intent still wants playback', async () => {
    const bridge = createMediaBridge();
    const onDiagnostic = jest.fn();
    const loading = deferred<undefined>();
    bridge.loadCompositionPreview.mockImplementationOnce(() => loading.promise);
    const preview = coordinator(bridge, new FakeAppState(), onDiagnostic);

    const initialPlay = preview.playComposition(project());
    await Promise.resolve();
    await preview.playComposition(project());
    expect(usePlaybackStore.getState()).toMatchObject({
      desiredPlaying: true,
      controlRevision: 2,
    });

    loading.reject(new Error('late load failure'));
    await initialPlay;

    expect(bridge.releasePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 2,
    });
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'composition', code: 'PREVIEW_COMMAND_FAILED' }),
    );
    expect(usePlaybackStore.getState()).toMatchObject({
      loading: false,
      loaded: false,
      playing: false,
      desiredPlaying: false,
      error: expect.any(String),
    });
  });

  it('does not let a rejected queued seek overwrite a newer pause', async () => {
    const bridge = createMediaBridge();
    const onDiagnostic = jest.fn();
    const loading = deferred<undefined>();
    const seeking = deferred<undefined>();
    bridge.loadCompositionPreview.mockImplementationOnce(() => loading.promise);
    bridge.seekPreview.mockImplementationOnce(() => seeking.promise);
    const preview = coordinator(bridge, new FakeAppState(), onDiagnostic);

    const playPromise = preview.playComposition(project());
    await Promise.resolve();
    await preview.seek(750, false);
    loading.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.seekPreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 2,
      positionMs: 750,
      resumeAfterSeek: false,
    });

    await preview.pauseComposition();
    seeking.reject(new Error('late seek failure'));
    await playPromise;

    expect(bridge.releasePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 3,
    });
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(usePlaybackStore.getState()).toMatchObject({
      loading: false,
      playing: false,
      desiredPlaying: false,
      pausePending: false,
      error: null,
    });
  });

  it('cancels a pending composition while the prior selection pause is delayed', async () => {
    const bridge = createMediaBridge();
    const delayedPause = deferred<undefined>();
    const preview = coordinator(bridge);
    await preview.loadSelection(project(), clipA);
    bridge.pausePreview.mockImplementationOnce(() => delayedPause.promise);

    const playPromise = preview.playComposition(project());
    await Promise.resolve();
    expect(usePlaybackStore.getState()).toMatchObject({
      mode: 'composition',
      loading: true,
      desiredPlaying: true,
    });
    expect(bridge.loadCompositionPreview).not.toHaveBeenCalled();

    await preview.pauseComposition();
    expect(bridge.pausePreview).toHaveBeenCalledTimes(1);
    expect(usePlaybackStore.getState()).toMatchObject({
      mode: 'composition',
      loading: false,
      playing: false,
      desiredPlaying: false,
      pausePending: false,
      error: null,
    });

    delayedPause.resolve(undefined);
    await playPromise;
    expect(bridge.loadCompositionPreview).not.toHaveBeenCalled();
    expect(bridge.playPreview).not.toHaveBeenCalled();
    expect(bridge.releasePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 1,
    });
  });

  it('gives rapid play pause play intents strictly increasing control revisions', async () => {
    const bridge = createMediaBridge();
    const preview = coordinator(bridge);
    const previewProject = project();

    await preview.playComposition(previewProject);
    await preview.pauseComposition();
    await preview.playComposition(previewProject);

    expect(bridge.playPreview.mock.calls.map(([request]) => request.controlRevision)).toEqual([
      1, 3,
    ]);
    expect(bridge.pausePreview).toHaveBeenLastCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 2,
    });
    expect(usePlaybackStore.getState()).toMatchObject({
      desiredPlaying: true,
      controlRevision: 3,
    });
  });

  it('uses native status as the clock and ignores stale/out-of-order events', async () => {
    const bridge = createMediaBridge();
    const preview = coordinator(bridge);
    await preview.loadSelection(project(), clipA);
    await preview.play();

    bridge.emitStatus(status({ sequence: 2, controlRevision: 1, playing: true, positionMs: 750 }));
    expect(usePlaybackStore.getState()).toMatchObject({
      loaded: true,
      playing: true,
      positionMs: 750,
    });

    bridge.emitStatus(status({ sequence: 1, controlRevision: 1, positionMs: 250 }));
    bridge.emitStatus(
      status({ playbackSessionId: 'stale', jobId: 'stale', sequence: 3, positionMs: 1_500 }),
    );
    expect(usePlaybackStore.getState().positionMs).toBe(750);
  });

  it('records the stable native error code without media identifiers or paths', async () => {
    const bridge = createMediaBridge();
    const onDiagnostic = jest.fn();
    const preview = coordinator(bridge, new FakeAppState(), onDiagnostic);
    await preview.loadSelection(project(), clipA);

    bridge.emitError({
      jobId: 'session-1',
      operation: 'preview',
      sequence: 1,
      stage: 'prepare',
      generation: 1,
      code: 'PREVIEW_PREPARE_FAILED',
      message: 'private native detail',
    });

    expect(onDiagnostic).toHaveBeenCalledWith({
      operation: 'preview',
      projectId: PROJECT_ID,
      jobId: 'session-1',
      generation: 1,
      stage: 'prepare',
      code: 'PREVIEW_PREPARE_FAILED',
    });
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('private native detail');
  });

  it('preserves composition order and drops an inconsistent clip position', async () => {
    const bridge = createMediaBridge();
    const preview = coordinator(bridge);
    await preview.loadComposition(project());

    const request = bridge.loadCompositionPreview.mock.calls[0]?.[0];
    expect(request?.clips.map(({ clipId }) => clipId)).toEqual([CLIP_A_ID, CLIP_B_ID]);

    bridge.emitStatus(
      status({
        mode: 'composition',
        durationMs: 8_000,
        currentClipIndex: 1,
        currentClipId: CLIP_A_ID,
      }),
    );
    expect(usePlaybackStore.getState().loaded).toBe(false);

    bridge.emitStatus(
      status({
        mode: 'composition',
        sequence: 2,
        durationMs: 8_000,
        currentClipIndex: 1,
        currentClipId: CLIP_B_ID,
      }),
    );
    expect(usePlaybackStore.getState()).toMatchObject({
      loaded: true,
      currentClipIndex: 1,
      currentClipId: CLIP_B_ID,
    });
  });

  it('pauses in background, suppresses playing status, and does not auto-resume', async () => {
    const bridge = createMediaBridge();
    const appState = new FakeAppState();
    const preview = coordinator(bridge, appState);
    await preview.loadSelection(project(), clipA);
    await preview.play();
    bridge.emitStatus(status({ playing: true, controlRevision: 1 }));

    appState.emit('background');
    await Promise.resolve();
    expect(bridge.pausePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 2,
    });
    expect(usePlaybackStore.getState().playing).toBe(false);

    bridge.emitStatus(status({ sequence: 2, controlRevision: 1, playing: true, positionMs: 100 }));
    expect(usePlaybackStore.getState().playing).toBe(false);
    appState.emit('active');
    expect(bridge.playPreview).toHaveBeenCalledTimes(1);
  });

  it('clamps seeks and confirms release for the active project', async () => {
    const bridge = createMediaBridge();
    const preview = coordinator(bridge);
    await preview.loadSelection(project(), clipA);
    bridge.emitStatus(status({ durationMs: 3_000, positionMs: 1_000 }));

    await preview.seek(50_000);
    expect(bridge.seekPreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 1,
      positionMs: 3_000,
      resumeAfterSeek: false,
    });

    await preview.releaseProject(PROJECT_ID);
    expect(bridge.releasePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 2,
    });
    expect(usePlaybackStore.getState()).toMatchObject({
      projectId: null,
      loaded: false,
      playing: false,
    });

    bridge.emitStatus(status({ sequence: 99, playing: true, positionMs: 2_500 }));
    expect(usePlaybackStore.getState()).toMatchObject({
      projectId: null,
      loaded: false,
      playing: false,
      positionMs: 0,
    });

    const editedProject = {
      ...project(),
      clips: [{ ...clipA, endMs: 2_000 }],
    };
    await preview.toggleComposition(editedProject, 750);
    expect(bridge.loadCompositionPreview).toHaveBeenCalledTimes(1);
    expect(bridge.seekPreview).toHaveBeenLastCalledWith({
      playbackSessionId: 'session-1',
      generation: 2,
      controlRevision: 1,
      positionMs: 750,
      resumeAfterSeek: false,
    });
  });

  it('keeps a failed native release visible to callers so mutations can abort', async () => {
    const bridge = createMediaBridge();
    const preview = coordinator(bridge);
    await preview.loadSelection(project(), clipA);
    bridge.releasePreview.mockRejectedValueOnce(new Error('release failed'));

    await expect(preview.releaseProject(PROJECT_ID)).rejects.toMatchObject({
      code: 'PREVIEW_COMMAND_FAILED',
    });
    expect(usePlaybackStore.getState()).toMatchObject({
      projectId: PROJECT_ID,
      loaded: false,
      playing: false,
      error: expect.any(String),
    });
  });

  it('keeps an optimistic pause frozen and releases an unknown native state on failure', async () => {
    const bridge = createMediaBridge();
    const onDiagnostic = jest.fn();
    const preview = coordinator(bridge, new FakeAppState(), onDiagnostic);
    await preview.loadSelection(project(), clipA);
    bridge.pausePreview.mockRejectedValueOnce(new Error('pause failed'));

    const pausePromise = preview.pause();
    expect(usePlaybackStore.getState()).toMatchObject({
      playing: false,
      desiredPlaying: false,
      pausePending: true,
      controlRevision: 1,
    });
    await pausePromise;

    expect(bridge.releasePreview).toHaveBeenCalledWith({
      playbackSessionId: 'session-1',
      generation: 1,
      controlRevision: 1,
    });
    expect(usePlaybackStore.getState()).toMatchObject({
      playing: false,
      desiredPlaying: false,
      pausePending: false,
      error: expect.any(String),
    });
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'pause', code: 'PREVIEW_COMMAND_FAILED' }),
    );
  });
});
