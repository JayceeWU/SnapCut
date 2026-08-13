import { randomUUID } from 'expo-crypto';
import { z } from 'zod';

import { snapCutSourceSchema } from '@/domain/schemas';
import type { SnapCutProject, SnapCutSource, SourceKind } from '@/domain/types';
import { SnapCutMediaContractError } from '@/native/SnapCutMedia';
import type { NativeErrorEvent, ProgressEvent } from '@/native/SnapCutMedia.events';
import type {
  ImportResult,
  ImportSourceRequest,
  PickedSource,
  SnapCutMediaApi,
  SourceInspection,
} from '@/native/SnapCutMedia.types';
import type {
  BeginImportInput,
  FinalizeImportInput,
  ImportTransactionPaths,
} from '@/repositories/ImportTransaction';
import type { ImportProgressSnapshot, ImportStateSink } from '@/stores/importStore';
import { importStateSink } from '@/stores/importStore';
import {
  importFailure,
  invalidNativeResultFailure,
  mapImportError,
  type ImportFailure,
} from './ImportErrors';
import { HeavyMediaTaskQueue, heavyMediaTaskQueue } from './HeavyMediaTaskQueue';
import type { WaveformSchedulerPort } from './WaveformScheduler';

export const MAX_SOURCE_BYTES = 600 * 1024 * 1024;

const pickedSourceSchema = z.strictObject({
  sourceUri: z
    .string()
    .min(1)
    .refine((uri) => uri.startsWith('content://') || uri.startsWith('file://')),
  suggestedName: z.string().min(1).nullable(),
  suggestedMimeType: z.string().min(1).nullable(),
  suggestedSizeBytes: z.number().int().positive().nullable(),
});

const nullableNonNegativeInteger = z.number().int().nonnegative().nullable();
const sourceInspectionSchema = z.strictObject({
  sourceKind: z.enum(['video-extracted-aac', 'm4a', 'm4s-aac', 'mp3', 'flac', 'wav']),
  codecMime: z.string().min(1),
  durationMs: z.number().int().positive(),
  sampleRateHz: z.number().int().positive(),
  channelCount: z.union([z.literal(1), z.literal(2)]),
  encodedBitrateBps: z.number().int().positive().nullable(),
  pcmBitsPerSample: z.union([z.literal(8), z.literal(16), z.literal(24), z.literal(32)]).nullable(),
  aacProfile: z.enum(['aac-lc', 'he-aac-v1', 'he-aac-v2']).nullable(),
  codecConfigFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  encoderDelayFrames: nullableNonNegativeInteger,
  encoderPaddingFrames: nullableNonNegativeInteger,
  fileSizeBytes: z.number().int().positive().nullable(),
  requiresStreamingSizeVerification: z.boolean(),
  drmProtected: z.boolean(),
});

const importResultSchema = sourceInspectionSchema
  .omit({ fileSizeBytes: true, requiresStreamingSizeVerification: true, drmProtected: true })
  .extend({
    outputFileUri: z.string().min(1),
    fileSizeBytes: z.number().int().positive(),
    privateAudioSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const progressEventSchema = z.strictObject({
  jobId: z.string().min(1),
  operation: z.literal('import'),
  sequence: z.number().int().nonnegative(),
  stage: z.enum(['inspecting', 'extracting_or_copying', 'verifying', 'committing', 'complete']),
  generation: z.number().int().positive(),
  fraction: z.number().min(0).max(1).nullable(),
  format: z.string().optional(),
});

export type ImportMediaPort = Pick<
  SnapCutMediaApi,
  'pickSource' | 'inspectSource' | 'importSource' | 'cancelImport'
> & {
  addEventListener(
    eventName: 'onImportProgress',
    listener: (event: ProgressEvent) => void,
  ): { remove(): void };
  addEventListener(
    eventName: 'onNativeError',
    listener: (event: NativeErrorEvent) => void,
  ): { remove(): void };
};

export interface ImportRepositoryPort {
  get(projectId: string): SnapCutProject | null;
  beginImport(input: BeginImportInput): ImportTransactionPaths | Promise<ImportTransactionPaths>;
  finalizeImport(input: FinalizeImportInput): Promise<SnapCutProject>;
  cancelImport(jobId: string): void | Promise<void>;
}

export interface ImportDiagnostic {
  readonly operation: 'import';
  readonly projectId: string;
  readonly sourceId: string;
  readonly jobId: string;
  readonly generation: number;
  readonly stage: ImportProgressSnapshot['stage'];
  readonly code: ImportFailure['code'];
  readonly nativeStage?: string;
  readonly causeCategory?: NativeErrorEvent['causeCategory'];
  readonly contractFields?: string;
}

export interface ImportCoordinatorOptions {
  readonly queue?: HeavyMediaTaskQueue;
  readonly stateSink?: ImportStateSink;
  readonly waveformScheduler?: WaveformSchedulerPort;
  readonly jobIdFactory?: () => string;
  readonly sourceIdFactory?: () => string;
  readonly now?: () => string;
  readonly maxSourceBytes?: number;
  readonly onDiagnostic?: (diagnostic: ImportDiagnostic) => void;
}

export type ImportOutcome =
  | {
      readonly status: 'imported';
      readonly project: SnapCutProject;
      readonly sourceId: string;
      readonly waveformScheduled: boolean;
    }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly failure: ImportFailure };

interface ActiveImport {
  readonly jobId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly generation: number;
  stage: ImportProgressSnapshot['stage'];
  fraction: number | null;
  lastSequence: number;
  cancelRequested: boolean;
  canCancel: boolean;
  cleanup: Promise<void> | null;
  nativeStage?: string;
  causeCategory?: NativeErrorEvent['causeCategory'];
}

class StaleImportOperationError extends Error {}
class InvalidNativeResultError extends Error {}

function privateAudioFileName(sourceKind: SourceKind): string {
  switch (sourceKind) {
    case 'mp3':
      return 'source.mp3';
    case 'flac':
      return 'source.flac';
    case 'wav':
      return 'source.wav';
    case 'video-extracted-aac':
    case 'm4a':
    case 'm4s-aac':
      return 'source.m4a';
  }
}

function inspectionMatchesResult(
  inspection: SourceInspection,
  result: ImportResult,
  expectedOutputFileUri: string,
): boolean {
  return (
    result.outputFileUri === expectedOutputFileUri &&
    result.sourceKind === inspection.sourceKind &&
    result.codecMime === inspection.codecMime &&
    result.durationMs === inspection.durationMs &&
    result.sampleRateHz === inspection.sampleRateHz &&
    result.channelCount === inspection.channelCount &&
    result.encodedBitrateBps === inspection.encodedBitrateBps &&
    result.pcmBitsPerSample === inspection.pcmBitsPerSample &&
    result.aacProfile === inspection.aacProfile &&
    result.codecConfigFingerprint === inspection.codecConfigFingerprint &&
    result.encoderDelayFrames === inspection.encoderDelayFrames &&
    result.encoderPaddingFrames === inspection.encoderPaddingFrames
  );
}

/**
 * Owns the transient picker capability only for the duration of one import.
 * It never reads a URI in JavaScript and never puts URI/name/MIME hints in
 * state, diagnostics, project metadata, or player requests.
 */
export class ImportCoordinator {
  private readonly queue: HeavyMediaTaskQueue;
  private readonly stateSink: ImportStateSink;
  private readonly waveformScheduler: WaveformSchedulerPort | undefined;
  private readonly jobIdFactory: () => string;
  private readonly sourceIdFactory: () => string;
  private readonly now: () => string;
  private readonly maxSourceBytes: number;
  private readonly onDiagnostic: ((diagnostic: ImportDiagnostic) => void) | undefined;
  private readonly progressSubscription: { remove(): void };
  private readonly errorSubscription: { remove(): void };
  private active: ActiveImport | null = null;
  private generation = 0;
  private lastImportedSourceId: string | null = null;

  constructor(
    private readonly media: ImportMediaPort,
    private readonly repository: ImportRepositoryPort,
    options: ImportCoordinatorOptions = {},
  ) {
    this.queue = options.queue ?? heavyMediaTaskQueue;
    this.stateSink = options.stateSink ?? importStateSink;
    this.waveformScheduler = options.waveformScheduler;
    this.jobIdFactory = options.jobIdFactory ?? randomUUID;
    this.sourceIdFactory = options.sourceIdFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxSourceBytes = options.maxSourceBytes ?? MAX_SOURCE_BYTES;
    this.onDiagnostic = options.onDiagnostic;
    this.progressSubscription = media.addEventListener('onImportProgress', (event) =>
      this.handleProgress(event),
    );
    this.errorSubscription = media.addEventListener('onNativeError', (event) =>
      this.handleNativeError(event),
    );
  }

  importIntoProject(projectId: string): Promise<ImportOutcome> {
    if (this.active !== null) {
      return Promise.resolve({
        status: 'failed',
        failure: importFailure('JOB_ALREADY_RUNNING'),
      });
    }
    if (this.repository.get(projectId) === null) {
      return Promise.resolve({ status: 'failed', failure: importFailure('INVALID_REQUEST') });
    }

    const context: ActiveImport = {
      jobId: this.jobIdFactory(),
      projectId,
      sourceId: this.sourceIdFactory(),
      generation: ++this.generation,
      stage: 'picking',
      fraction: null,
      lastSequence: -1,
      cancelRequested: false,
      canCancel: true,
      cleanup: null,
    };
    this.active = context;
    this.publish(context);

    return this.queue.enqueue({ operation: 'import', jobId: context.jobId }, () =>
      this.runImport(context),
    );
  }

  async cancelActive(): Promise<void> {
    const context = this.active;
    if (context === null) {
      return;
    }
    if (!context.canCancel) {
      return;
    }
    context.cancelRequested = true;
    ++this.generation;
    context.stage = 'canceling';
    context.fraction = null;
    this.publish(context, { generation: this.generation });
    try {
      await this.cleanup(context);
    } catch (error) {
      // Never delete app-owned staging until native cancellation confirms its
      // descriptors/codecs are closed. Keep the failure visible and allow the
      // queued worker to finish its own guarded cleanup path.
      context.cancelRequested = false;
      context.stage = 'failed';
      const failure = mapImportError(error);
      this.publishFailure(context, failure);
      this.onDiagnostic?.({
        operation: 'import',
        projectId: context.projectId,
        sourceId: context.sourceId,
        jobId: context.jobId,
        generation: context.generation,
        stage: 'canceling',
        code: failure.code,
      });
      if (this.active === context) this.active = null;
      return;
    }
    if (this.active === context) {
      this.active = null;
      this.publishTerminal('cancelled', this.generation);
    }
  }

  async pauseForBackground(): Promise<void> {
    // ACTION_OPEN_DOCUMENT pauses the host Activity while the system picker is
    // visible. No media resource exists yet, so keep that picker capability
    // alive and cancel only real native processing.
    if (this.active?.stage === 'picking') return;
    await this.cancelActive();
  }

  dispose(): void {
    this.progressSubscription.remove();
    this.errorSubscription.remove();
  }

  private async runImport(context: ActiveImport): Promise<ImportOutcome> {
    let stagingCreated = false;
    try {
      this.assertCurrent(context);
      const picked = this.parsePickedSource(await this.media.pickSource());
      this.assertCurrent(context);
      if (picked === null) {
        this.publishTerminal('cancelled', context.generation);
        return { status: 'cancelled' };
      }

      context.stage = 'inspecting';
      context.fraction = null;
      this.publish(context);
      const inspection = sourceInspectionSchema.parse(
        await this.media.inspectSource({
          jobId: context.jobId,
          generation: context.generation,
          sourceUri: picked.sourceUri,
          maxSourceBytes: this.maxSourceBytes,
        }),
      ) as SourceInspection;
      this.assertCurrent(context);
      if (inspection.drmProtected) {
        throw Object.assign(new Error('DRM source'), { code: 'DRM_UNSUPPORTED' });
      }

      const paths = await this.repository.beginImport({
        jobId: context.jobId,
        projectId: context.projectId,
        sourceId: context.sourceId,
        privateAudioFileName: privateAudioFileName(inspection.sourceKind),
      });
      stagingCreated = true;
      try {
        this.assertCurrent(context);
      } catch (error) {
        // Cancellation may have completed while an injected/asynchronous
        // repository was still creating staging. Remove that late directory.
        await Promise.resolve(this.repository.cancelImport(context.jobId)).catch(() => undefined);
        throw error;
      }

      context.stage = 'extracting_or_copying';
      context.fraction = null;
      this.publish(context);
      const importRequest: ImportSourceRequest = {
        jobId: context.jobId,
        generation: context.generation,
        sourceUri: picked.sourceUri,
        outputFileUri: paths.outputFileUri,
        maxSourceBytes: this.maxSourceBytes,
      };
      const result = importResultSchema.parse(
        await this.media.importSource(importRequest),
      ) as ImportResult;
      this.assertCurrent(context);
      if (!inspectionMatchesResult(inspection, result, paths.outputFileUri)) {
        throw new InvalidNativeResultError();
      }

      context.stage = 'committing';
      context.fraction = null;
      context.canCancel = false;
      this.publish(context);
      const source = this.buildSource(context, result);
      const project = await this.repository.finalizeImport({
        jobId: context.jobId,
        projectId: context.projectId,
        source,
        privateAudioSha256: result.privateAudioSha256,
      });
      stagingCreated = false;

      context.stage = 'scheduling_waveform';
      this.publish(context);
      let waveformScheduled = false;
      if (this.waveformScheduler !== undefined) {
        try {
          await this.waveformScheduler.schedule({
            projectId: context.projectId,
            sourceId: context.sourceId,
          });
          waveformScheduled = true;
        } catch {
          // The source is already committed and remains usable with a pending waveform.
        }
      }

      this.lastImportedSourceId = context.sourceId;
      this.publishTerminal('complete', context.generation, context.sourceId);
      return {
        status: 'imported',
        project,
        sourceId: context.sourceId,
        waveformScheduled,
      };
    } catch (error) {
      const failureStage = context.stage;
      let terminalError = error;
      if (stagingCreated || context.cancelRequested) {
        try {
          await this.cleanup(context);
        } catch (cleanupError) {
          terminalError = cleanupError;
          context.cancelRequested = false;
        }
      }
      if (
        terminalError === error &&
        (error instanceof StaleImportOperationError || context.cancelRequested)
      ) {
        return { status: 'cancelled' };
      }
      const failure =
        terminalError instanceof InvalidNativeResultError || terminalError instanceof z.ZodError
          ? invalidNativeResultFailure()
          : mapImportError(terminalError);
      context.stage = 'failed';
      context.fraction = null;
      this.publishFailure(context, failure);
      this.onDiagnostic?.({
        operation: 'import',
        projectId: context.projectId,
        sourceId: context.sourceId,
        jobId: context.jobId,
        generation: context.generation,
        stage: failureStage,
        code: failure.code,
        ...(context.nativeStage === undefined ? {} : { nativeStage: context.nativeStage }),
        ...(context.causeCategory === undefined ? {} : { causeCategory: context.causeCategory }),
        ...(terminalError instanceof SnapCutMediaContractError &&
        terminalError.issuePaths.length > 0
          ? { contractFields: terminalError.issuePaths.join(',') }
          : {}),
      });
      return { status: 'failed', failure };
    } finally {
      if (this.active === context) {
        this.active = null;
      }
    }
  }

  private buildSource(context: ActiveImport, result: ImportResult): SnapCutSource {
    const sourceNumber = (this.repository.get(context.projectId)?.sources.length ?? 0) + 1;
    return snapCutSourceSchema.parse({
      id: context.sourceId,
      // Provider display names are transient/private picker metadata. Persist a
      // deterministic project-local label so multiple sources remain usable
      // without leaking the user's original file name.
      displayName: `Source ${sourceNumber}`,
      originalMimeType: null,
      sourceKind: result.sourceKind,
      privateAudioFileName: privateAudioFileName(result.sourceKind),
      privateAudioSha256: result.privateAudioSha256,
      durationMs: result.durationMs,
      codecMime: result.codecMime,
      sampleRateHz: result.sampleRateHz,
      channelCount: result.channelCount,
      encodedBitrateBps: result.encodedBitrateBps,
      pcmBitsPerSample: result.pcmBitsPerSample,
      aacProfile: result.aacProfile,
      codecConfigFingerprint: result.codecConfigFingerprint,
      encoderDelayFrames: result.encoderDelayFrames,
      encoderPaddingFrames: result.encoderPaddingFrames,
      fileSizeBytes: result.fileSizeBytes,
      waveformFileName: 'waveform.json',
      waveformStatus: 'pending',
      createdAt: this.now(),
    }) as SnapCutSource;
  }

  private parsePickedSource(value: PickedSource | null): PickedSource | null {
    return value === null ? null : (pickedSourceSchema.parse(value) as PickedSource);
  }

  private handleProgress(event: ProgressEvent): void {
    const parsed = progressEventSchema.safeParse(event);
    const context = this.active;
    if (
      !parsed.success ||
      context === null ||
      context.cancelRequested ||
      parsed.data.jobId !== context.jobId ||
      parsed.data.generation !== context.generation ||
      parsed.data.sequence <= context.lastSequence
    ) {
      return;
    }
    context.lastSequence = parsed.data.sequence;
    // A native "complete" event means its private output is ready. Only the
    // finalizeImport Promise may publish the coordinator's terminal complete.
    context.stage = parsed.data.stage === 'complete' ? 'verifying' : parsed.data.stage;
    context.fraction = parsed.data.fraction;
    this.publish(context);
  }

  private handleNativeError(event: NativeErrorEvent): void {
    const context = this.active;
    if (
      context === null ||
      event.operation !== 'import' ||
      event.jobId !== context.jobId ||
      event.generation !== context.generation
    ) {
      return;
    }
    if (event.nativeStage !== undefined) context.nativeStage = event.nativeStage;
    if (event.causeCategory !== undefined) context.causeCategory = event.causeCategory;
  }

  private assertCurrent(context: ActiveImport): void {
    if (
      this.active !== context ||
      context.cancelRequested ||
      context.generation !== this.generation
    ) {
      throw new StaleImportOperationError();
    }
  }

  private cleanup(context: ActiveImport): Promise<void> {
    context.cleanup ??= (async () => {
      await this.media.cancelImport(context.jobId);
      await Promise.resolve(this.repository.cancelImport(context.jobId));
    })();
    return context.cleanup.catch((error: unknown) => {
      context.cleanup = null;
      throw error;
    });
  }

  private publish(
    context: ActiveImport,
    overrides: Partial<Pick<ImportProgressSnapshot, 'generation' | 'failure'>> = {},
  ): void {
    this.stateSink.publish({
      generation: overrides.generation ?? context.generation,
      activeJobId: context.jobId,
      projectId: context.projectId,
      sourceId: context.sourceId,
      stage: context.stage,
      fraction: context.fraction,
      failure: overrides.failure ?? null,
      lastImportedSourceId: this.lastImportedSourceId,
    });
  }

  private publishTerminal(
    stage: 'complete' | 'cancelled',
    generation: number,
    sourceId: string | null = null,
  ): void {
    this.stateSink.publish({
      generation,
      activeJobId: null,
      projectId: null,
      sourceId: null,
      stage,
      fraction: stage === 'complete' ? 1 : null,
      failure: null,
      lastImportedSourceId: sourceId ?? this.lastImportedSourceId,
    });
  }

  private publishFailure(context: ActiveImport, failure: ImportFailure): void {
    this.stateSink.publish({
      generation: context.generation,
      activeJobId: null,
      projectId: null,
      sourceId: null,
      stage: 'failed',
      fraction: null,
      failure,
      lastImportedSourceId: this.lastImportedSourceId,
    });
  }
}
