import { randomUUID } from 'expo-crypto';

import type { WaveformStatus } from '@/domain/types';
import type { ProgressEvent } from '@/native/SnapCutMedia.events';
import type { SnapCutMediaApi } from '@/native/SnapCutMedia.types';
import {
  waveformJobStateSink,
  type WaveformJobSnapshot,
  type WaveformJobStateSink,
} from '@/stores/waveformJobStore';
import { HeavyMediaTaskQueue, heavyMediaTaskQueue } from './HeavyMediaTaskQueue';

export interface WaveformScheduleRequest {
  readonly projectId: string;
  readonly sourceId: string;
}

export interface WaveformRepositoryPort {
  resolveSourceAudioUri(projectId: string, sourceId: string): string;
  resolveSourceWaveformUri(projectId: string, sourceId: string): string;
  updateSourceWaveformStatus(
    projectId: string,
    sourceId: string,
    status: WaveformStatus,
  ): Promise<unknown>;
}

export type NativeWaveformPort = Pick<SnapCutMediaApi, 'generateWaveform' | 'cancelWaveform'> & {
  addEventListener(
    eventName: 'onWaveformProgress',
    listener: (event: ProgressEvent) => void,
  ): { remove(): void };
};

export interface WaveformDiagnostic {
  readonly operation: 'waveform';
  readonly projectId: string;
  readonly sourceId: string;
  readonly jobId: string;
  readonly generation: number;
  readonly outcome: 'failed' | 'cancelled';
}

export interface WaveformSchedulerOptions {
  readonly queue?: HeavyMediaTaskQueue;
  readonly idFactory?: () => string;
  readonly stateSink?: WaveformJobStateSink;
  readonly onDiagnostic?: (diagnostic: WaveformDiagnostic) => void;
}

interface ScheduledWaveform {
  readonly jobId: string;
  readonly generation: number;
  readonly request: WaveformScheduleRequest;
  cancelled: boolean;
  started: boolean;
  lastSequence: number;
  completion: Promise<void> | null;
}

export interface WaveformSchedulerPort {
  schedule(request: WaveformScheduleRequest): void | Promise<void>;
}

function scheduleKey(request: WaveformScheduleRequest): string {
  return `${request.projectId}:${request.sourceId}`;
}

function progressStage(stage: string): WaveformJobSnapshot['stage'] {
  if (stage === 'writing' || stage === 'complete') return stage;
  return 'processing';
}

/** Runs only against committed project media; staging URIs are never accepted. */
export class WaveformScheduler implements WaveformSchedulerPort {
  private readonly queue: HeavyMediaTaskQueue;
  private readonly idFactory: () => string;
  private readonly stateSink: WaveformJobStateSink;
  private readonly onDiagnostic: ((diagnostic: WaveformDiagnostic) => void) | undefined;
  private readonly progressSubscription: { remove(): void };
  private readonly scheduledBySource = new Map<string, ScheduledWaveform>();
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly media: NativeWaveformPort,
    private readonly repository: WaveformRepositoryPort,
    options: WaveformSchedulerOptions = {},
  ) {
    this.queue = options.queue ?? heavyMediaTaskQueue;
    this.idFactory = options.idFactory ?? randomUUID;
    this.stateSink = options.stateSink ?? waveformJobStateSink;
    this.onDiagnostic = options.onDiagnostic;
    this.progressSubscription = media.addEventListener('onWaveformProgress', (event) =>
      this.handleProgress(event),
    );
  }

  schedule(request: WaveformScheduleRequest): void {
    if (this.disposed) return;
    const key = scheduleKey(request);
    if (this.scheduledBySource.has(key)) return;

    const scheduled: ScheduledWaveform = {
      jobId: this.idFactory(),
      generation: ++this.generation,
      request,
      cancelled: false,
      started: false,
      lastSequence: -1,
      completion: null,
    };
    this.scheduledBySource.set(key, scheduled);
    this.publish(scheduled, {
      status: 'queued',
      stage: 'queued',
      fraction: null,
    });

    scheduled.completion = this.queue
      .enqueue({ operation: 'waveform', jobId: scheduled.jobId }, () => this.run(scheduled))
      .catch(() => undefined)
      .finally(() => {
        if (this.scheduledBySource.get(key) === scheduled) {
          this.scheduledBySource.delete(key);
        }
      });
  }

  async cancel(projectId: string, sourceId: string): Promise<void> {
    const scheduled = this.scheduledBySource.get(scheduleKey({ projectId, sourceId }));
    if (scheduled === undefined) return;

    scheduled.cancelled = true;
    ++this.generation;
    if (scheduled.started) {
      this.publish(scheduled, {
        status: 'cancelling',
        stage: 'processing',
        fraction: null,
      });
      await this.media.cancelWaveform(scheduled.jobId).catch(() => undefined);
      await scheduled.completion;
      return;
    }

    await this.repository
      .updateSourceWaveformStatus(projectId, sourceId, 'pending')
      .catch(() => undefined);
    this.publish(scheduled, {
      status: 'pending',
      stage: null,
      fraction: null,
    });
    const key = scheduleKey(scheduled.request);
    if (this.scheduledBySource.get(key) === scheduled) {
      this.scheduledBySource.delete(key);
    }
  }

  async cancelAll(): Promise<void> {
    await Promise.all(
      [...this.scheduledBySource.values()].map((scheduled) =>
        this.cancel(scheduled.request.projectId, scheduled.request.sourceId),
      ),
    );
    await this.queue.whenIdle();
  }

  async whenIdle(): Promise<void> {
    await this.queue.whenIdle();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.progressSubscription.remove();
    this.stateSink.clearAll();
  }

  private async run(scheduled: ScheduledWaveform): Promise<void> {
    const { projectId, sourceId } = scheduled.request;
    if (scheduled.cancelled) {
      await this.repository
        .updateSourceWaveformStatus(projectId, sourceId, 'pending')
        .catch(() => undefined);
      this.publish(scheduled, { status: 'pending', stage: null, fraction: null });
      return;
    }

    scheduled.started = true;
    try {
      await this.repository.updateSourceWaveformStatus(projectId, sourceId, 'processing');
      this.publish(scheduled, { status: 'processing', stage: 'processing', fraction: 0 });
      if (scheduled.cancelled) {
        throw Object.assign(new Error('Cancelled'), { code: 'WAVEFORM_CANCELLED' });
      }
      await this.media.generateWaveform({
        jobId: scheduled.jobId,
        generation: scheduled.generation,
        sourceId,
        audioFileUri: this.repository.resolveSourceAudioUri(projectId, sourceId),
        outputWaveformFileUri: this.repository.resolveSourceWaveformUri(projectId, sourceId),
        binCount: 8192,
      });
      if (scheduled.cancelled) {
        throw Object.assign(new Error('Cancelled'), { code: 'WAVEFORM_CANCELLED' });
      }
      await this.repository.updateSourceWaveformStatus(projectId, sourceId, 'ready');
      this.publish(scheduled, { status: 'ready', stage: 'complete', fraction: 1 });
    } catch (error) {
      const cancelled =
        scheduled.cancelled ||
        (typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'WAVEFORM_CANCELLED');
      await this.repository
        .updateSourceWaveformStatus(projectId, sourceId, cancelled ? 'pending' : 'failed')
        .catch(() => undefined);
      this.publish(scheduled, {
        status: cancelled ? 'pending' : 'failed',
        stage: null,
        fraction: null,
      });
      this.onDiagnostic?.({
        operation: 'waveform',
        projectId,
        sourceId,
        jobId: scheduled.jobId,
        generation: scheduled.generation,
        outcome: cancelled ? 'cancelled' : 'failed',
      });
    }
  }

  private handleProgress(event: ProgressEvent): void {
    if (this.disposed || event.operation !== 'waveform') return;
    const scheduled = [...this.scheduledBySource.values()].find(
      ({ jobId }) => jobId === event.jobId,
    );
    if (
      scheduled === undefined ||
      scheduled.cancelled ||
      event.generation !== scheduled.generation ||
      event.sequence <= scheduled.lastSequence
    ) {
      return;
    }
    scheduled.lastSequence = event.sequence;
    this.publish(scheduled, {
      status: 'processing',
      stage: progressStage(event.stage),
      fraction: event.fraction,
    });
  }

  private publish(
    scheduled: ScheduledWaveform,
    state: Pick<WaveformJobSnapshot, 'status' | 'stage' | 'fraction'>,
  ): void {
    if (this.disposed || this.scheduledBySource.get(scheduleKey(scheduled.request)) !== scheduled) {
      return;
    }
    this.stateSink.publish({
      jobId: scheduled.jobId,
      projectId: scheduled.request.projectId,
      sourceId: scheduled.request.sourceId,
      generation: scheduled.generation,
      status: state.status,
      stage: state.stage,
      fraction: state.fraction,
      lastSequence: scheduled.lastSequence,
    });
  }
}
