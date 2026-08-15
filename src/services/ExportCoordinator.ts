import { AppState, type AppStateStatus } from 'react-native';
import { randomUUID } from 'expo-crypto';

import { copy } from '@/constants';
import { diagnosticLog } from '@/diagnostics';
import {
  compositionDurationMs,
  createDefaultExportBaseName,
  validateExportBaseName,
  type SnapCutExportFormat,
  type SnapCutExportRecord,
  type SnapCutProject,
} from '@/domain';
import SnapCutMedia from '@/native/SnapCutMedia';
import type {
  ExportAudioResult,
  NativeErrorEvent,
  NativePreviewClip,
  ProgressEvent,
  SnapCutMediaApi,
  SnapCutMediaEventApi,
  SnapCutMediaSubscription,
} from '@/native';
import {
  buildNativeSequentialClips,
  previewCoordinator,
  type CommittedSourceResolverPort,
  PrivateSourceResolver,
} from './PreviewCoordinator';
import { HeavyMediaTaskQueue, heavyMediaTaskQueue } from './HeavyMediaTaskQueue';
import { useExportStore } from '@/stores/exportStore';

export type ExportMediaPort = Pick<
  SnapCutMediaApi,
  'preflightExport' | 'cancelExportPreflight' | 'exportAudio' | 'cancelExport' | 'shareExport'
> &
  Pick<SnapCutMediaEventApi, 'addEventListener'>;

export interface ExportPreviewReleasePort {
  releaseProject(projectId: string): Promise<void>;
}

interface AppStateSubscription {
  remove(): void;
}

export interface ExportAppStatePort {
  readonly currentState: AppStateStatus;
  addEventListener(
    eventName: 'change',
    listener: (state: AppStateStatus) => void,
  ): AppStateSubscription;
}

export interface ExportCoordinatorOptions {
  media?: ExportMediaPort;
  sourceResolver?: CommittedSourceResolverPort;
  preview?: ExportPreviewReleasePort;
  appState?: ExportAppStatePort;
  idFactory?: () => string;
  now?: () => Date;
  queue?: HeavyMediaTaskQueue;
  onDiagnostic?: (entry: ExportDiagnostic) => void;
}

export interface ExportDiagnostic {
  operation: 'preflight' | 'export';
  projectId: string;
  jobId: string;
  generation: number;
  stage: string;
  code: string;
}

interface ActiveJob {
  projectId: string;
  jobId: string;
  generation: number;
  operation: 'preflight' | 'export';
  format: SnapCutExportFormat | null;
  lastSequence: number;
}

export class ExportCoordinator {
  private readonly media: ExportMediaPort;
  private readonly sourceResolver: CommittedSourceResolverPort;
  private readonly preview: ExportPreviewReleasePort;
  private readonly appState: ExportAppStatePort;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly queue: HeavyMediaTaskQueue;
  private readonly onDiagnostic: (entry: ExportDiagnostic) => void;
  private active: ActiveJob | null = null;
  private generation = 0;
  private operationToken = 0;
  private subscriptions: SnapCutMediaSubscription[] = [];
  private appStateSubscription: AppStateSubscription | null = null;

  constructor(options: ExportCoordinatorOptions = {}) {
    this.media = options.media ?? SnapCutMedia;
    this.sourceResolver = options.sourceResolver ?? new PrivateSourceResolver();
    this.preview = options.preview ?? previewCoordinator;
    this.appState = options.appState ?? AppState;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.queue = options.queue ?? heavyMediaTaskQueue;
    this.onDiagnostic =
      options.onDiagnostic ??
      ((entry) => {
        void diagnosticLog.append('error', 'export.failed', entry);
      });
  }

  start(): void {
    if (this.subscriptions.length > 0) return;
    this.subscriptions = [
      this.media.addEventListener('onExportProgress', (event) => this.handleProgress(event)),
      this.media.addEventListener('onNativeError', (event) => this.handleError(event)),
    ];
    this.appStateSubscription = this.appState.addEventListener('change', (state) => {
      if (state !== 'active' && this.active) void this.cancel().catch(() => undefined);
    });
  }

  stop(): void {
    void this.cancel().catch(() => undefined);
    this.subscriptions.forEach((subscription) => subscription.remove());
    this.subscriptions = [];
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.active = null;
    useExportStore.getState().reset();
  }

  async prepare(project: SnapCutProject): Promise<void> {
    if (project.clips.length === 0) throw new Error('Cannot export an empty composition.');
    this.start();
    await this.cancel();

    const active = this.createJob(project.id, 'preflight', null);
    const token = ++this.operationToken;
    useExportStore
      .getState()
      .beginPreflight(
        active,
        createDefaultExportBaseName(project.name, this.now()),
        compositionDurationMs(project.clips),
      );

    try {
      await this.preview.releaseProject(project.id);
      const preflight = await this.queue.enqueue(
        { operation: 'export', jobId: active.jobId },
        async () => {
          if (!this.isCurrent(active, token)) throw new SupersededExportOperationError();
          return this.media.preflightExport({
            ...active,
            projectId: project.id,
            clips: this.nativeClips(project),
          });
        },
      );
      if (!this.isCurrent(active, token)) return;
      this.active = null;
      useExportStore.getState().preflightReady(preflight);
    } catch (error) {
      if (!this.isCurrent(active, token)) return;
      this.active = null;
      this.recordFailure(active, 'preflight', error);
      useExportStore.getState().fail(copy.export.preflightError);
      throw error;
    }
  }

  async export(project: SnapCutProject): Promise<SnapCutExportRecord> {
    const state = useExportStore.getState();
    if (this.active || state.status !== 'ready') {
      throw new Error('An export operation is already active or preflight is not ready.');
    }
    const preflight = state.preflight;
    const selectedFormat = state.selectedFormat;
    if (!preflight || !selectedFormat || state.projectId !== project.id) {
      throw new Error('Export preflight is not ready.');
    }
    const format = preflight.formats.find((candidate) => candidate.format === selectedFormat);
    if (!format?.available || format.sampleRateHz === null || format.channelCount === null) {
      throw new Error(format?.reasons[0] ?? 'The selected export format is unavailable.');
    }
    const outputSampleRateHz = format.sampleRateHz;
    const outputChannelCount = format.channelCount;
    const usesM4aStreamCopy = selectedFormat === 'm4a' && format.mode === 'aac-stream-copy';
    const displayNameWithoutExtension = validateExportBaseName(state.displayNameWithoutExtension);

    const active = this.createJob(project.id, 'export', selectedFormat);
    const token = ++this.operationToken;
    useExportStore.getState().beginExport(active);
    try {
      await this.preview.releaseProject(project.id);
      const result = await this.queue.enqueue(
        { operation: 'export', jobId: active.jobId },
        async () => {
          if (!this.isCurrent(active, token)) throw new SupersededExportOperationError();
          return this.media.exportAudio({
            ...active,
            projectId: project.id,
            format: selectedFormat,
            displayNameWithoutExtension,
            clips: this.nativeClips(project),
            outputSampleRateHz: usesM4aStreamCopy ? null : this.decodedRate(outputSampleRateHz),
            outputChannelCount: usesM4aStreamCopy ? null : outputChannelCount,
            m4aPlan: usesM4aStreamCopy ? preflight.m4aPlan : null,
          });
        },
      );
      if (!this.isCurrent(active, token)) {
        throw new Error('A newer export operation replaced this result.');
      }
      this.active = null;
      useExportStore.getState().complete(result);
      return this.toRecord(result);
    } catch (error) {
      if (this.isCurrent(active, token)) {
        this.active = null;
        this.recordFailure(active, 'export', error);
        useExportStore.getState().fail(copy.export.exportError);
      }
      throw error;
    }
  }

  async cancel(): Promise<void> {
    const active = this.active;
    if (!active) return;
    ++this.operationToken;
    useExportStore.getState().beginCancelling();
    try {
      if (active.operation === 'preflight') {
        await this.media.cancelExportPreflight(active.jobId);
      } else {
        await this.media.cancelExport(active.jobId);
      }
    } finally {
      if (this.active === active) {
        this.active = null;
        useExportStore.getState().fail(copy.export.cancelled);
      }
    }
  }

  async share(result: ExportAudioResult): Promise<void> {
    await this.media.shareExport({ contentUri: result.contentUri, format: result.format });
  }

  reset(): void {
    if (this.active) throw new Error('Cannot reset while native export work is active.');
    useExportStore.getState().reset();
  }

  private createJob(
    projectId: string,
    operation: ActiveJob['operation'],
    format: SnapCutExportFormat | null,
  ): ActiveJob {
    if (this.active) throw new Error('An export operation is already active.');
    const active: ActiveJob = {
      projectId,
      jobId: this.idFactory(),
      generation: ++this.generation,
      operation,
      format,
      lastSequence: 0,
    };
    this.active = active;
    return active;
  }

  private nativeClips(project: SnapCutProject): NativePreviewClip[] {
    return buildNativeSequentialClips(project, project.clips, this.sourceResolver);
  }

  private decodedRate(value: number): 32_000 | 44_100 | 48_000 {
    if (value === 32_000 || value === 44_100 || value === 48_000) return value;
    throw new Error('Native preflight returned an unsupported decoded sample rate.');
  }

  private handleProgress(event: ProgressEvent): void {
    const active = this.active;
    if (
      !active ||
      event.operation !== active.operation ||
      event.jobId !== active.jobId ||
      event.generation !== active.generation ||
      event.sequence <= active.lastSequence ||
      (active.format !== null && event.format !== active.format)
    ) {
      return;
    }
    active.lastSequence = event.sequence;
    useExportStore.getState().applyProgress(event.stage, event.fraction);
  }

  private handleError(event: NativeErrorEvent): void {
    const active = this.active;
    if (
      !active ||
      event.operation !== active.operation ||
      event.jobId !== active.jobId ||
      event.generation !== active.generation
    ) {
      return;
    }
    // Native error events are terminal for their matching job. Revoke JS
    // ownership before updating the store so a late promise resolution cannot
    // replace the visible failure with success, and Close can reset normally.
    ++this.operationToken;
    this.active = null;
    this.recordFailure(active, event.stage, event);
    useExportStore
      .getState()
      .fail(
        active.operation === 'preflight' ? copy.export.preflightError : copy.export.exportError,
      );
  }

  private recordFailure(active: ActiveJob, stage: string, error: unknown): void {
    this.onDiagnostic({
      operation: active.operation,
      projectId: active.projectId,
      jobId: active.jobId,
      generation: active.generation,
      stage,
      code: errorCode(
        error,
        active.operation === 'preflight' ? 'EXPORT_PREFLIGHT_FAILED' : 'UNKNOWN_NATIVE_ERROR',
      ),
    });
  }

  private isCurrent(active: ActiveJob, token: number): boolean {
    return this.active === active && this.operationToken === token;
  }

  private toRecord(result: ExportAudioResult): SnapCutExportRecord {
    return {
      ...result,
      exportedAt: this.now().toISOString(),
    };
  }
}

class SupersededExportOperationError extends Error {}

function errorCode(error: unknown, fallback: string): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : fallback;
}

export const exportCoordinator = new ExportCoordinator();
