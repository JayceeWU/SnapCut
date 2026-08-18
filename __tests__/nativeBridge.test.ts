import { describe, expect, jest, test } from '@jest/globals';

import { createSnapCutMediaClient, SnapCutMediaContractError } from '@/native/SnapCutMedia';
import { isCurrentNativeEvent } from '@/native/SnapCutMedia.events';
import type { SnapCutMediaNativeModule } from '@/native/SnapCutMedia.types';

function nativeModule(overrides: Partial<SnapCutMediaNativeModule> = {}): SnapCutMediaNativeModule {
  return {
    getHealth: () => ({
      moduleName: 'SnapCutMedia',
      moduleVersion: '1.0.0',
      platform: 'android',
      ready: true,
      mediaPipelineAvailable: false,
    }),
    getCodecBuildInfo: () => ({
      moduleVersion: '1.0.0',
      media3: { version: '1.10.1', available: true },
      lame: { version: null, available: false },
      libsamplerate: { version: null, available: false },
      nativeCodecBridgeLoaded: false,
    }),
    pickSource: async () => null,
    inspectSource: async () => {
      throw new Error('not called');
    },
    verifyPrivateMedia: async () => ({ fileSizeBytes: 1, sha256: 'a'.repeat(64) }),
    importSource: async (request) => ({
      outputFileUri: request.outputFileUri,
      sourceKind: 'mp3',
      codecMime: 'audio/mpeg',
      durationMs: 1_000,
      sampleRateHz: 44_100,
      channelCount: 2,
      encodedBitrateBps: 320_000,
      pcmBitsPerSample: null,
      aacProfile: null,
      codecConfigFingerprint: null,
      encoderDelayFrames: null,
      encoderPaddingFrames: null,
      fileSizeBytes: 40_000,
      privateAudioSha256: 'a'.repeat(64),
    }),
    cancelImport: async () => undefined,
    generateWaveform: async () => undefined,
    cancelWaveform: async () => undefined,
    loadSelectionPreview: async () => undefined,
    loadCompositionPreview: async () => undefined,
    playPreview: async () => undefined,
    pausePreview: async () => undefined,
    seekPreview: async () => undefined,
    releasePreview: async () => undefined,
    preflightExport: async () => {
      throw new Error('not called');
    },
    cancelExportPreflight: async () => undefined,
    exportAudio: async () => {
      throw new Error('not called');
    },
    cancelExport: async () => undefined,
    addListener: () => ({ remove: () => undefined }),
    ...overrides,
  };
}

describe('SnapCutMedia TypeScript boundary', () => {
  test('reports actual foundational availability without fake codec success', () => {
    const client = createSnapCutMediaClient(() => nativeModule());

    expect(client.getHealth()).toMatchObject({ ready: true, mediaPipelineAvailable: false });
    expect(client.getCodecBuildInfo()).toEqual({
      moduleVersion: '1.0.0',
      media3: { version: '1.10.1', available: true },
      lame: { version: null, available: false },
      libsamplerate: { version: null, available: false },
      nativeCodecBridgeLoaded: false,
    });
  });

  test('accepts the explicit primitive source-inspection bridge map', async () => {
    const native = nativeModule({
      inspectSource: async () => ({
        sourceKind: 'video-extracted-aac',
        codecMime: 'audio/mp4a-latm',
        durationMs: 12_345,
        sampleRateHz: 48_000,
        channelCount: 2,
        encodedBitrateBps: 192_000,
        pcmBitsPerSample: null,
        aacProfile: 'aac-lc',
        codecConfigFingerprint: 'a'.repeat(64),
        encoderDelayFrames: 0,
        encoderPaddingFrames: null,
        fileSizeBytes: 500,
        requiresStreamingSizeVerification: false,
        drmProtected: false,
      }),
    });

    await expect(
      createSnapCutMediaClient(() => native).inspectSource({
        jobId: 'job-1',
        generation: 1,
        sourceUri: 'content://provider/item',
        maxSourceBytes: 600 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({ sourceKind: 'video-extracted-aac', aacProfile: 'aac-lc' });
  });

  test('accepts the explicit primitive imported-source bridge map', async () => {
    const requested = 'file:/data/user/0/com.snapcut.app/files/staging/output.partial';
    const native = nativeModule({
      importSource: async () => ({
        outputFileUri: requested,
        sourceKind: 'video-extracted-aac',
        codecMime: 'audio/mp4a-latm',
        durationMs: 12_301,
        sampleRateHz: 48_000,
        channelCount: 2,
        encodedBitrateBps: 192_000,
        pcmBitsPerSample: null,
        aacProfile: 'aac-lc',
        codecConfigFingerprint: 'b'.repeat(64),
        encoderDelayFrames: null,
        encoderPaddingFrames: null,
        fileSizeBytes: 450,
        privateAudioSha256: 'c'.repeat(64),
      }),
    });

    await expect(
      createSnapCutMediaClient(() => native).importSource({
        jobId: 'job-1',
        generation: 1,
        sourceUri: 'content://provider/item',
        outputFileUri: requested,
        maxSourceBytes: 600 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({
      outputFileUri: requested,
      sourceKind: 'video-extracted-aac',
      aacProfile: 'aac-lc',
      encoderDelayFrames: null,
    });
  });

  test('classifies malformed inspection results without retaining private values', async () => {
    const native = nativeModule({
      inspectSource: async () =>
        ({
          sourceKind: 'content://private/provider/item',
          codecMime: 'private-name.mp3',
        }) as never,
    });

    const error = await createSnapCutMediaClient(() => native)
      .inspectSource({
        jobId: 'job-1',
        generation: 1,
        sourceUri: 'content://provider/item',
        maxSourceBytes: 600 * 1024 * 1024,
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(SnapCutMediaContractError);
    expect(error).toMatchObject({
      code: 'INVALID_NATIVE_RESULT',
      issuePaths: expect.arrayContaining(['sourceKind', 'durationMs']),
    });
    expect(JSON.stringify((error as SnapCutMediaContractError).issuePaths)).not.toContain(
      'content://',
    );
    expect(JSON.stringify((error as SnapCutMediaContractError).issuePaths)).not.toContain(
      'private-name',
    );
  });

  test('rejects malformed native health and unknown fields', () => {
    const native = nativeModule({
      getHealth: () =>
        ({
          moduleName: 'SnapCutMedia',
          moduleVersion: '1.0.0',
          platform: 'android',
          ready: true,
          mediaPipelineAvailable: false,
          secretPath: '/data/user/0/com.snapcut.app',
        }) as never,
    });

    expect(() => createSnapCutMediaClient(() => native).getHealth()).toThrow(
      SnapCutMediaContractError,
    );
  });

  test('requires importSource to echo the output URI exactly', async () => {
    const requested = 'file:///data/user/0/com.snapcut.app/files/staging/output.partial';
    const changed = requested.replace('file:///', 'file:/');
    const native = nativeModule({
      importSource: async (request) => ({
        ...(await nativeModule().importSource(request)),
        outputFileUri: changed,
      }),
    });
    const client = createSnapCutMediaClient(() => native);

    await expect(
      client.importSource({
        jobId: 'job-1',
        generation: 1,
        sourceUri: 'content://provider/item?token=opaque',
        outputFileUri: requested,
        maxSourceBytes: 600 * 1024 * 1024,
      }),
    ).rejects.toThrow('changed the caller-provided outputFileUri');
  });

  test('validates private-media verification request and strict native facts', async () => {
    const requested = 'file:///data/user/0/com.snapcut.app/files/SnapCut/projects/p/source.m4a';
    const native = nativeModule({
      verifyPrivateMedia: async () =>
        ({
          fileSizeBytes: 40_000,
          sha256: 'a'.repeat(64),
          echoedExpectedHash: 'must-not-cross-boundary',
        }) as never,
    });
    const client = createSnapCutMediaClient(() => native);

    await expect(client.verifyPrivateMedia({ fileUri: requested })).rejects.toThrow(
      SnapCutMediaContractError,
    );
    await expect(
      client.verifyPrivateMedia({ fileUri: 'content://provider/private' }),
    ).rejects.toThrow(SnapCutMediaContractError);
  });

  test('validates events before delivering them to listeners', () => {
    let nativeListener: ((event: unknown) => void) | undefined;
    const listener = jest.fn();
    const native = nativeModule({
      addListener: (_name, callback) => {
        nativeListener = callback;
        return { remove: () => undefined };
      },
    });
    createSnapCutMediaClient(() => native).addEventListener('onImportProgress', listener);

    expect(() =>
      nativeListener?.({
        jobId: 'job-1',
        operation: 'import',
        sequence: 1,
        stage: 'copying',
        generation: 1,
        fraction: 0.5,
        sourceUri: 'content://must-not-cross-event-boundary',
      }),
    ).toThrow(SnapCutMediaContractError);
    expect(listener).not.toHaveBeenCalled();
  });

  test('requires the complete native playback clock contract', () => {
    let nativeListener: ((event: unknown) => void) | undefined;
    const listener = jest.fn();
    const native = nativeModule({
      addListener: (_name, callback) => {
        nativeListener = callback;
        return { remove: () => undefined };
      },
    });
    createSnapCutMediaClient(() => native).addEventListener('onPlaybackStatus', listener);
    const event = {
      jobId: 'session-1',
      operation: 'preview',
      sequence: 1,
      stage: 'playing',
      generation: 2,
      controlRevision: 4,
      playbackSessionId: 'session-1',
      mode: 'selection',
      loaded: true,
      playing: true,
      positionMs: 500,
      durationMs: 1_000,
      currentClipIndex: 0,
      currentClipId: 'clip-1',
    };

    expect(() => nativeListener?.(event)).toThrow(SnapCutMediaContractError);
    nativeListener?.({ ...event, didJustFinish: false });
    expect(listener).toHaveBeenCalledWith({ ...event, didJustFinish: false });
  });

  test('requires control revisions and an explicit seek resume policy', async () => {
    const seekPreview = jest.fn(async () => undefined);
    const client = createSnapCutMediaClient(() => nativeModule({ seekPreview }));
    const request = {
      playbackSessionId: 'session-1',
      generation: 2,
      controlRevision: 7,
      positionMs: 500,
      resumeAfterSeek: false,
    };

    await expect(client.seekPreview(request)).resolves.toBeUndefined();
    expect(seekPreview).toHaveBeenCalledWith(request);
    await expect(
      client.seekPreview({
        playbackSessionId: 'session-1',
        generation: 2,
        controlRevision: 8,
        positionMs: 600,
      } as never),
    ).rejects.toThrow(SnapCutMediaContractError);
  });

  test('identifies a stale native preflight bridge without exposing values', async () => {
    const preflightExport = jest.fn(async () => ({
      preferredFormat: 'm4a',
      m4aPlan: {
        planVersion: 1,
        planId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-15T00:00:00.000Z',
        eligible: false,
        reasons: ['AAC stream copy is unavailable.'],
        codecConfigFingerprint: null,
        sampleRateHz: null,
        channelCount: null,
        maxBoundaryAdjustmentMs: 0,
        estimatedOutputBytes: null,
        sourceSnapshots: [],
        clips: [],
      },
      formats: [
        {
          format: 'm4a',
          available: true,
          reasons: [],
          estimatedOutputBytes: 1,
          requiredFreeBytes: 1,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
      ],
    }));
    const client = createSnapCutMediaClient(() =>
      nativeModule({ preflightExport: preflightExport as never }),
    );
    const error = await client
      .preflightExport({
        jobId: 'job-1',
        generation: 1,
        projectId: 'project-1',
        clips: [
          {
            clipId: 'clip-1',
            sourceId: 'source-1',
            audioFileUri: 'file:///private/source.m4a',
            startMs: 0,
            endMs: 1_000,
            trackId: 'track-1',
            timelineStartMs: 0,
            gain: 1,
            fadeInMs: 0,
            fadeOutMs: 0,
          },
        ],
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(SnapCutMediaContractError);
    expect(error).toMatchObject({
      boundary: 'preflightExport',
      code: 'INVALID_NATIVE_RESULT',
      issuePaths: expect.arrayContaining(['contractVersion']),
    });
    expect(JSON.stringify((error as SnapCutMediaContractError).issuePaths)).not.toContain(
      'file://',
    );
  });

  test('accepts the explicit AAC re-encode request and 160 kbps mono result', async () => {
    const exportAudio = jest.fn(async () => ({
      format: 'm4a' as const,
      mode: 'aac-lossy-encode' as const,
      contentUri: 'content://media/audio/1',
      displayName: 'mix.m4a',
      requestedDurationMs: 2_000,
      actualDurationMs: 2_010,
      sampleRateHz: 48_000,
      channelCount: 1 as const,
      bitrateKbps: 160 as const,
      maxBoundaryAdjustmentMs: 0,
      fileSizeBytes: 50_000,
    }));
    const client = createSnapCutMediaClient(() => nativeModule({ exportAudio }));
    const request = {
      jobId: 'export-1',
      generation: 1,
      projectId: 'project-1',
      format: 'm4a' as const,
      displayNameWithoutExtension: 'mix',
      clips: [
        {
          clipId: 'clip-1',
          sourceId: 'source-1',
          audioFileUri: 'file:///data/user/0/com.snapcut.app/files/SnapCut/projects/p/source.m4a',
          startMs: 0,
          endMs: 2_000,
          trackId: 'track-1' as const,
          timelineStartMs: 0,
          gain: 0.8,
          fadeInMs: 500 as const,
          fadeOutMs: 500 as const,
        },
      ],
      outputSampleRateHz: 48_000 as const,
      outputChannelCount: 1 as const,
      m4aPlan: null,
    };

    await expect(client.exportAudio(request)).resolves.toMatchObject({
      mode: 'aac-lossy-encode',
      bitrateKbps: 160,
    });
    expect(exportAudio).toHaveBeenCalledWith(request);
  });

  test('drops stale job or generation events through the shared predicate', () => {
    const active = { jobId: 'job-2', generation: 7 };
    expect(isCurrentNativeEvent({ jobId: 'job-2', generation: 7 }, active)).toBe(true);
    expect(isCurrentNativeEvent({ jobId: 'job-1', generation: 7 }, active)).toBe(false);
    expect(isCurrentNativeEvent({ jobId: 'job-2', generation: 6 }, active)).toBe(false);
    expect(isCurrentNativeEvent({ jobId: 'job-2', generation: 7 }, null)).toBe(false);
  });
});
