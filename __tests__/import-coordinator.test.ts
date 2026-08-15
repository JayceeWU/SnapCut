import { addFullSourceClip } from '@/domain/clips';
import { addSource } from '@/domain/projects';
import type { SnapCutProject } from '@/domain/types';
import type { NativeErrorEvent, ProgressEvent } from '@/native/SnapCutMedia.events';
import type { ImportResult, PickedSource, SourceInspection } from '@/native/SnapCutMedia.types';
import type {
  BeginImportInput,
  FinalizeImportInput,
  ImportTransactionPaths,
} from '@/repositories/ImportTransaction';
import { HeavyMediaTaskQueue } from '@/services/HeavyMediaTaskQueue';
import {
  ImportCoordinator,
  type ImportDiagnostic,
  type ImportMediaPort,
  type ImportRepositoryPort,
} from '@/services/ImportCoordinator';
import type { ImportProgressSnapshot, ImportStateSink } from '@/stores/importStore';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_IDS = [
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const CLIP_IDS = [
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
];
const NOW = '2026-08-12T23:00:00.000Z';
const PROVIDER_URI = 'content://provider/document/audio?secret=opaque';

const inspection: SourceInspection = {
  sourceKind: 'm4a',
  codecMime: 'audio/mp4a-latm',
  durationMs: 1000,
  sampleRateHz: 44100,
  channelCount: 2,
  encodedBitrateBps: 256000,
  pcmBitsPerSample: null,
  aacProfile: 'aac-lc',
  codecConfigFingerprint: 'b'.repeat(64),
  encoderDelayFrames: 0,
  encoderPaddingFrames: 0,
  fileSizeBytes: 500,
  requiresStreamingSizeVerification: false,
  drmProtected: false,
};

function emptyProject(): SnapCutProject {
  return {
    schemaVersion: 6,
    namePromptCompleted: true,
    id: PROJECT_ID,
    name: 'Project',
    createdAt: NOW,
    updatedAt: NOW,
    sources: [],
    trackCount: 2,
    clips: [],
    lastExport: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition was not reached.');
}

class FakeMedia implements ImportMediaPort {
  pickResults: (PickedSource | null | Error | Promise<PickedSource | null>)[] = [];
  inspectResults: (SourceInspection | Error | Promise<SourceInspection>)[] = [];
  importResults: (ImportResult | Error | Promise<ImportResult>)[] = [];
  readonly inspectRequests: Parameters<ImportMediaPort['inspectSource']>[0][] = [];
  readonly importRequests: Parameters<ImportMediaPort['importSource']>[0][] = [];
  readonly cancelled: string[] = [];
  cancelError: Error | null = null;
  private listener: ((event: ProgressEvent) => void) | null = null;
  private errorListener: ((event: NativeErrorEvent) => void) | null = null;

  async pickSource(): Promise<PickedSource | null> {
    const value = this.pickResults.shift() ?? null;
    if (value instanceof Error) throw value;
    return await value;
  }

  async inspectSource(
    request: Parameters<ImportMediaPort['inspectSource']>[0],
  ): Promise<SourceInspection> {
    this.inspectRequests.push(request);
    const value = this.inspectResults.shift() ?? inspection;
    if (value instanceof Error) throw value;
    return await value;
  }

  async importSource(
    request: Parameters<ImportMediaPort['importSource']>[0],
  ): Promise<ImportResult> {
    this.importRequests.push(request);
    const value = this.importResults.shift() ?? resultFor(request.outputFileUri);
    if (value instanceof Error) throw value;
    return value;
  }

  async cancelImport(jobId: string): Promise<void> {
    this.cancelled.push(jobId);
    if (this.cancelError) throw this.cancelError;
  }

  addEventListener(
    eventName: 'onImportProgress',
    listener: (event: ProgressEvent) => void,
  ): { remove(): void };
  addEventListener(
    eventName: 'onNativeError',
    listener: (event: NativeErrorEvent) => void,
  ): { remove(): void };
  addEventListener(
    eventName: 'onImportProgress' | 'onNativeError',
    listener: ((event: ProgressEvent) => void) | ((event: NativeErrorEvent) => void),
  ): { remove(): void } {
    if (eventName === 'onImportProgress') {
      this.listener = listener as (event: ProgressEvent) => void;
      return { remove: () => (this.listener = null) };
    }
    this.errorListener = listener as (event: NativeErrorEvent) => void;
    return { remove: () => (this.errorListener = null) };
  }

  emit(event: ProgressEvent): void {
    this.listener?.(event);
  }

  emitError(event: NativeErrorEvent): void {
    this.errorListener?.(event);
  }
}

class FakeRepository implements ImportRepositoryPort {
  project = emptyProject();
  readonly begun: BeginImportInput[] = [];
  readonly finalized: FinalizeImportInput[] = [];
  readonly cancelled: string[] = [];

  get(projectId: string): SnapCutProject | null {
    return projectId === this.project.id ? this.project : null;
  }

  beginImport(input: BeginImportInput): ImportTransactionPaths {
    this.begun.push(input);
    return {
      jobId: input.jobId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      stagingDirectoryUri: `file:///documents/SnapCut/staging/.import-${input.jobId}`,
      outputFileUri: `file:///documents/SnapCut/staging/.import-${input.jobId}/sources/${input.sourceId}/${input.privateAudioFileName}.partial`,
      privateAudioRelativePath: `sources/${input.sourceId}/${input.privateAudioFileName}`,
    };
  }

  async finalizeImport(input: FinalizeImportInput): Promise<SnapCutProject> {
    this.finalized.push(input);
    this.project = addFullSourceClip(
      addSource(this.project, input.source, NOW),
      input.source.id,
      input.clipId,
      input.targetTrackId,
      NOW,
    );
    return this.project;
  }

  cancelImport(jobId: string): void {
    this.cancelled.push(jobId);
  }
}

class StateRecorder implements ImportStateSink {
  readonly snapshots: ImportProgressSnapshot[] = [];
  publish(snapshot: ImportProgressSnapshot): void {
    this.snapshots.push(snapshot);
  }
  last(): ImportProgressSnapshot {
    const last = this.snapshots.at(-1);
    if (last === undefined) throw new Error('No state published.');
    return last;
  }
}

function picked(): PickedSource {
  return {
    sourceUri: PROVIDER_URI,
    suggestedName: 'Private song.m4a',
    suggestedMimeType: 'application/octet-stream',
    suggestedSizeBytes: 500,
  };
}

function resultFor(outputFileUri: string, inspected: SourceInspection = inspection): ImportResult {
  const {
    fileSizeBytes: _ignored,
    drmProtected: _drm,
    requiresStreamingSizeVerification: _stream,
    ...metadata
  } = inspected;
  return {
    ...metadata,
    outputFileUri,
    fileSizeBytes: 500,
    privateAudioSha256: 'a'.repeat(64),
  };
}

function setup(onDiagnostic?: (diagnostic: ImportDiagnostic) => void) {
  const media = new FakeMedia();
  const repository = new FakeRepository();
  const states = new StateRecorder();
  const sourceIds = [...SOURCE_IDS];
  const clipIds = [...CLIP_IDS];
  let job = 0;
  const scheduled: { projectId: string; sourceId: string }[] = [];
  const coordinator = new ImportCoordinator(media, repository, {
    queue: new HeavyMediaTaskQueue(),
    stateSink: states,
    now: () => NOW,
    jobIdFactory: () => `job-${++job}`,
    sourceIdFactory: () => sourceIds.shift() ?? SOURCE_IDS[0]!,
    clipIdFactory: () => clipIds.shift() ?? CLIP_IDS[0]!,
    waveformScheduler: {
      schedule: (request) => {
        scheduled.push(request);
      },
    },
    ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
  });
  return { media, repository, states, coordinator, scheduled };
}

describe('ImportCoordinator', () => {
  it('imports twice consecutively and never persists/logs picker URI hints', async () => {
    const { media, repository, states, coordinator, scheduled } = setup();
    media.pickResults.push(picked(), picked());

    const first = await coordinator.importIntoProject(PROJECT_ID);
    const second = await coordinator.importIntoProject(PROJECT_ID);

    expect(first.status).toBe('imported');
    expect(second.status).toBe('imported');
    expect(repository.finalized).toHaveLength(2);
    expect(scheduled).toHaveLength(2);
    expect(repository.project.sources.map(({ displayName }) => displayName)).toEqual([
      'Source 1',
      'Source 2',
    ]);
    expect(repository.project.clips).toEqual([
      expect.objectContaining({ id: CLIP_IDS[0], timelineStartMs: 0, trackId: 'track-1' }),
      expect.objectContaining({ id: CLIP_IDS[1], timelineStartMs: 1_000, trackId: 'track-1' }),
    ]);
    expect(JSON.stringify(repository.finalized)).not.toContain('content://');
    expect(JSON.stringify(repository.project)).not.toContain('content://');
    expect(JSON.stringify(repository.project)).not.toContain('Private song.m4a');
    expect(JSON.stringify(states.snapshots)).not.toContain('content://');
    expect(media.inspectRequests[0]?.sourceUri).toBe(PROVIDER_URI);
    expect(media.importRequests[0]?.sourceUri).toBe(PROVIDER_URI);
  });

  it('atomically places a later full source on the selected second track', async () => {
    const { media, repository, coordinator } = setup();
    repository.project = { ...repository.project, trackCount: 2 };
    media.pickResults.push(picked());

    const outcome = await coordinator.importIntoProject(PROJECT_ID, 'track-2');

    expect(outcome.status).toBe('imported');
    expect(repository.finalized[0]).toMatchObject({
      clipId: CLIP_IDS[0],
      targetTrackId: 'track-2',
    });
    expect(repository.project.clips[0]).toMatchObject({
      trackId: 'track-2',
      timelineStartMs: 0,
      startMs: 0,
      endMs: 1_000,
    });
  });

  it('commits FLAC input with a private source flac name', async () => {
    const { media, repository, coordinator } = setup();
    const flacInspection: SourceInspection = {
      ...inspection,
      sourceKind: 'flac',
      codecMime: 'audio/flac',
      pcmBitsPerSample: 24,
      aacProfile: null,
      codecConfigFingerprint: null,
      encoderDelayFrames: null,
      encoderPaddingFrames: null,
    };
    const outputFileUri = `file:///documents/SnapCut/staging/.import-job-1/sources/${SOURCE_IDS[0]}/source.flac.partial`;
    media.pickResults.push(picked());
    media.inspectResults.push(flacInspection);
    media.importResults.push(resultFor(outputFileUri, flacInspection));

    const outcome = await coordinator.importIntoProject(PROJECT_ID);

    expect(outcome.status).toBe('imported');
    expect(repository.begun[0]?.privateAudioFileName).toBe('source.flac');
    expect(repository.project.sources[0]?.sourceKind).toBe('flac');
    expect(repository.project.sources[0]?.privateAudioFileName).toBe('source.flac');
  });

  it('accepts authoritative AAC output metadata normalized by Android remuxing', async () => {
    const { media, repository, coordinator } = setup();
    const outputFileUri = `file:///documents/SnapCut/staging/.import-job-1/sources/${SOURCE_IDS[0]}/source.m4a.partial`;
    media.pickResults.push(picked());
    media.importResults.push({
      ...resultFor(outputFileUri),
      durationMs: 920,
      encodedBitrateBps: 192_000,
      codecConfigFingerprint: 'c'.repeat(64),
      encoderDelayFrames: null,
      encoderPaddingFrames: null,
    });

    const outcome = await coordinator.importIntoProject(PROJECT_ID);

    expect(outcome.status).toBe('imported');
    expect(repository.project.sources[0]).toMatchObject({
      durationMs: 920,
      codecConfigFingerprint: 'c'.repeat(64),
      encoderDelayFrames: null,
      encoderPaddingFrames: null,
    });
  });

  it('accepts Android 29 codec MIME and bit-depth normalization for FLAC', async () => {
    const { media, repository, coordinator } = setup();
    const flacInspection: SourceInspection = {
      ...inspection,
      sourceKind: 'flac',
      codecMime: 'audio/flac',
      pcmBitsPerSample: 24,
      aacProfile: null,
      codecConfigFingerprint: null,
      encoderDelayFrames: null,
      encoderPaddingFrames: null,
    };
    const outputFileUri = `file:///documents/SnapCut/staging/.import-job-1/sources/${SOURCE_IDS[0]}/source.flac.partial`;
    media.pickResults.push(picked());
    media.inspectResults.push(flacInspection);
    media.importResults.push({
      ...resultFor(outputFileUri, flacInspection),
      codecMime: 'audio/raw',
      pcmBitsPerSample: null,
    });

    const outcome = await coordinator.importIntoProject(PROJECT_ID);

    expect(outcome.status).toBe('imported');
    expect(repository.project.sources[0]).toMatchObject({
      sourceKind: 'flac',
      codecMime: 'audio/raw',
      pcmBitsPerSample: null,
    });
  });

  it.each([
    ['sourceKind', { sourceKind: 'm4s-aac' as const }],
    ['sampleRateHz', { sampleRateHz: 48_000 }],
    ['channelCount', { channelCount: 1 as const }],
    ['aacProfile', { aacProfile: 'he-aac-v1' as const }],
  ])('rejects and safely diagnoses a real %s integrity mismatch', async (field, changes) => {
    const onDiagnostic = jest.fn();
    const { media, repository, coordinator } = setup(onDiagnostic);
    const outputFileUri = `file:///documents/SnapCut/staging/.import-job-1/sources/${SOURCE_IDS[0]}/source.m4a.partial`;
    media.pickResults.push(picked());
    media.importResults.push({ ...resultFor(outputFileUri), ...changes });

    const outcome = await coordinator.importIntoProject(PROJECT_ID);

    expect(outcome).toMatchObject({ status: 'failed', failure: { code: 'INVALID_NATIVE_RESULT' } });
    expect(repository.finalized).toHaveLength(0);
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'INVALID_NATIVE_RESULT',
        contractFields: expect.stringContaining(field),
      }),
    );
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('content://');
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('Private song');
  });

  it('maps a native failure, clears the task, and succeeds on the next attempt', async () => {
    const { media, repository, states, coordinator } = setup();
    media.pickResults.push(picked(), picked());
    media.importResults.push(
      Object.assign(new Error('private technical details'), { code: 'CORRUPT_MEDIA' }),
    );

    const failed = await coordinator.importIntoProject(PROJECT_ID);
    const successful = await coordinator.importIntoProject(PROJECT_ID);

    expect(failed).toEqual({
      status: 'failed',
      failure: {
        code: 'CORRUPT_MEDIA',
        message: 'The selected media is damaged or incomplete.',
        retryable: true,
      },
    });
    expect(successful.status).toBe('imported');
    expect(repository.cancelled).toContain('job-1');
    expect(states.last().stage).toBe('complete');
  });

  it('cancels, ignores a late native result/event, and succeeds without restart', async () => {
    const { media, repository, states, coordinator } = setup();
    const late = deferred<ImportResult>();
    media.pickResults.push(picked(), picked());
    media.importResults.push(late.promise);

    const firstPromise = coordinator.importIntoProject(PROJECT_ID);
    await waitUntil(() => media.importRequests.length === 1);
    const firstRequest = media.importRequests[0];
    expect(firstRequest).toBeDefined();
    await coordinator.cancelActive();
    media.emit({
      jobId: 'job-1',
      operation: 'import',
      sequence: 99,
      stage: 'complete',
      generation: 1,
      fraction: 1,
    });
    late.resolve(resultFor(firstRequest!.outputFileUri));

    await expect(firstPromise).resolves.toEqual({ status: 'cancelled' });
    const second = await coordinator.importIntoProject(PROJECT_ID);
    expect(second.status).toBe('imported');
    expect(repository.finalized).toHaveLength(1);
    expect(repository.cancelled).toContain('job-1');
    expect(states.last().stage).toBe('complete');
  });

  it('does not delete staging when native cancellation cannot confirm resource release', async () => {
    const { media, repository, states, coordinator } = setup();
    const late = deferred<ImportResult>();
    media.pickResults.push(picked());
    media.importResults.push(late.promise);
    media.cancelError = Object.assign(new Error('native cleanup failed'), {
      code: 'OUTPUT_WRITE_FAILED',
    });

    const importPromise = coordinator.importIntoProject(PROJECT_ID);
    await waitUntil(() => media.importRequests.length === 1);
    await coordinator.cancelActive();

    expect(repository.cancelled).not.toContain('job-1');
    expect(states.last()).toMatchObject({
      stage: 'failed',
      failure: { code: 'OUTPUT_WRITE_FAILED' },
    });

    media.cancelError = null;
    const request = media.importRequests[0];
    expect(request).toBeDefined();
    late.resolve(resultFor(request!.outputFileUri));
    await expect(importPromise).resolves.toEqual({ status: 'cancelled' });
    expect(repository.cancelled).toContain('job-1');
  });

  it('keeps the system picker alive when Android reports the host Activity as backgrounded', async () => {
    const { media, repository, states, coordinator } = setup();
    const selection = deferred<PickedSource | null>();
    media.pickResults.push(selection.promise);

    const outcomePromise = coordinator.importIntoProject(PROJECT_ID);
    await waitUntil(() => states.last().stage === 'picking');
    await coordinator.pauseForBackground();

    expect(media.cancelled).toHaveLength(0);
    expect(repository.cancelled).toHaveLength(0);
    selection.resolve(picked());

    await expect(outcomePromise).resolves.toEqual(
      expect.objectContaining({
        status: 'imported',
        sourceId: SOURCE_IDS[0],
      }),
    );
  });

  it('rejects a native output URI mismatch before repository commit', async () => {
    const { media, repository, coordinator } = setup();
    media.pickResults.push(picked());
    media.importResults.push(resultFor('file:///wrong/output.m4a.partial'));

    const outcome = await coordinator.importIntoProject(PROJECT_ID);

    expect(outcome).toEqual({
      status: 'failed',
      failure: {
        code: 'INVALID_NATIVE_RESULT',
        message: 'The native import result did not pass integrity checks.',
        retryable: true,
      },
    });
    expect(repository.finalized).toHaveLength(0);
  });

  it('records only safe native inspection stage and category details', async () => {
    const onDiagnostic = jest.fn();
    const { media, states, coordinator } = setup(onDiagnostic);
    const pending = deferred<SourceInspection>();
    media.pickResults.push(picked());
    media.inspectResults.push(pending.promise);
    const outcomePromise = coordinator.importIntoProject(PROJECT_ID);
    await waitUntil(() => states.last().stage === 'inspecting');

    media.emitError({
      jobId: 'job-1',
      operation: 'import',
      sequence: 1,
      stage: 'extractor_open',
      generation: 1,
      code: 'SOURCE_UNREADABLE',
      message: 'The selected media cannot be opened.',
      nativeStage: 'extractor_open',
      causeCategory: 'provider',
    });
    pending.reject(
      Object.assign(new Error('content://private/item'), { code: 'SOURCE_UNREADABLE' }),
    );

    await expect(outcomePromise).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'SOURCE_UNREADABLE' },
    });
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SOURCE_UNREADABLE',
        nativeStage: 'extractor_open',
        causeCategory: 'provider',
      }),
    );
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('content://');
  });

  it('accepts only increasing progress sequences for the current generation', async () => {
    const { media, states, coordinator } = setup();
    const pending = deferred<ImportResult>();
    media.pickResults.push(picked());
    media.importResults.push(pending.promise);
    const outcomePromise = coordinator.importIntoProject(PROJECT_ID);
    await waitUntil(() => media.importRequests.length === 1);
    const request = media.importRequests[0];
    expect(request).toBeDefined();

    media.emit({
      jobId: 'job-1',
      operation: 'import',
      sequence: 2,
      stage: 'verifying',
      generation: 1,
      fraction: 0.8,
    });
    media.emit({
      jobId: 'job-1',
      operation: 'import',
      sequence: 1,
      stage: 'extracting_or_copying',
      generation: 1,
      fraction: 0.2,
    });
    expect(states.last().stage).toBe('verifying');
    expect(states.last().fraction).toBe(0.8);
    media.emit({
      jobId: 'job-1',
      operation: 'import',
      sequence: 3,
      stage: 'complete',
      generation: 1,
      fraction: 1,
    });
    // Native completion is not terminal until repository finalize succeeds.
    expect(states.last().stage).toBe('verifying');
    media.emit({
      jobId: 'job-1',
      operation: 'import',
      sequence: 4,
      stage: 'complete',
      generation: 99,
      fraction: 1,
    });
    expect(states.last().stage).toBe('verifying');
    expect(states.last().fraction).toBe(1);
    pending.resolve(resultFor(request!.outputFileUri));
    await outcomePromise;
  });

  it('does not expose staging media to a player API', () => {
    // The coordinator's public/injected surface deliberately has no preview/player port.
    const { coordinator } = setup();
    expect('player' in coordinator).toBe(false);
    expect('preview' in coordinator).toBe(false);
  });
});
