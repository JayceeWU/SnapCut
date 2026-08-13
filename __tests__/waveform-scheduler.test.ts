import type { WaveformStatus } from '@/domain/types';
import type { ProgressEvent } from '@/native/SnapCutMedia.events';
import { HeavyMediaTaskQueue } from '@/services/HeavyMediaTaskQueue';
import {
  WaveformScheduler,
  type NativeWaveformPort,
  type WaveformRepositoryPort,
} from '@/services/WaveformScheduler';
import { handleMediaAppStateChange, prepareProjectMediaDeletion } from '@/services/ImportRuntime';
import type { WaveformJobSnapshot, WaveformJobStateSink } from '@/stores';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';

function nativeWaveformPort(overrides: Partial<NativeWaveformPort> = {}): NativeWaveformPort {
  return {
    generateWaveform: async () => undefined,
    cancelWaveform: async () => undefined,
    addEventListener: () => ({ remove: () => undefined }),
    ...overrides,
  };
}

class WaveformStateRecorder implements WaveformJobStateSink {
  readonly snapshots: WaveformJobSnapshot[] = [];
  readonly clears: string[] = [];

  publish(snapshot: WaveformJobSnapshot): void {
    this.snapshots.push(snapshot);
  }

  clear(projectId: string, sourceId: string): void {
    this.clears.push(`${projectId}:${sourceId}`);
  }

  clearAll(): void {
    this.clears.push('all');
  }
}

class FakeWaveformRepository implements WaveformRepositoryPort {
  readonly statuses: WaveformStatus[] = [];

  resolveSourceAudioUri(): string {
    return `file:///documents/SnapCut/projects/${PROJECT_ID}/sources/${SOURCE_ID}/source.m4a`;
  }

  resolveSourceWaveformUri(): string {
    return `file:///documents/SnapCut/projects/${PROJECT_ID}/sources/${SOURCE_ID}/waveform.json`;
  }

  async updateSourceWaveformStatus(
    _projectId: string,
    _sourceId: string,
    status: WaveformStatus,
  ): Promise<void> {
    this.statuses.push(status);
  }
}

describe('WaveformScheduler', () => {
  it('waits behind an active heavy task on the shared queue', async () => {
    const repository = new FakeWaveformRepository();
    const queue = new HeavyMediaTaskQueue();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = queue.enqueue({ operation: 'import', jobId: 'import-job' }, () => blocker);
    const generated: string[] = [];
    const scheduler = new WaveformScheduler(
      nativeWaveformPort({
        generateWaveform: async ({ jobId }) => {
          generated.push(jobId);
        },
      }),
      repository,
      { queue, idFactory: () => 'waveform-job' },
    );

    scheduler.schedule({ projectId: PROJECT_ID, sourceId: SOURCE_ID });
    for (let attempt = 0; attempt < 20 && queue.getActive() === null; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(queue.getActive()).toEqual({ operation: 'import', jobId: 'import-job' });
    expect(generated).toEqual([]);
    release();
    await active;
    await scheduler.whenIdle();

    expect(generated).toEqual(['waveform-job']);
  });

  it('runs after scheduling against committed project media and marks ready', async () => {
    const repository = new FakeWaveformRepository();
    const requests: Parameters<NativeWaveformPort['generateWaveform']>[0][] = [];
    const media = nativeWaveformPort({
      generateWaveform: async (request) => {
        requests.push(request);
      },
    });
    const scheduler = new WaveformScheduler(media, repository, {
      queue: new HeavyMediaTaskQueue(),
      idFactory: () => 'waveform-job',
    });

    scheduler.schedule({ projectId: PROJECT_ID, sourceId: SOURCE_ID });
    await scheduler.whenIdle();

    expect(repository.statuses).toEqual(['processing', 'ready']);
    expect(requests).toEqual([
      {
        jobId: 'waveform-job',
        generation: 1,
        sourceId: SOURCE_ID,
        audioFileUri: `file:///documents/SnapCut/projects/${PROJECT_ID}/sources/${SOURCE_ID}/source.m4a`,
        outputWaveformFileUri: `file:///documents/SnapCut/projects/${PROJECT_ID}/sources/${SOURCE_ID}/waveform.json`,
        binCount: 8192,
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain('/staging/');
  });

  it('keeps committed audio and marks only waveform failed when native decoding fails', async () => {
    const repository = new FakeWaveformRepository();
    const media = nativeWaveformPort({
      generateWaveform: async () => {
        throw Object.assign(new Error('decode failure'), { code: 'WAVEFORM_DECODE_FAILED' });
      },
    });
    const scheduler = new WaveformScheduler(media, repository, {
      queue: new HeavyMediaTaskQueue(),
      idFactory: () => 'waveform-job',
    });

    scheduler.schedule({ projectId: PROJECT_ID, sourceId: SOURCE_ID });
    await scheduler.whenIdle();

    expect(repository.statuses).toEqual(['processing', 'failed']);
  });

  it('cancels active work, returns it to pending, and fully drains before resume', async () => {
    const repository = new FakeWaveformRepository();
    let rejectGeneration!: (reason: unknown) => void;
    const media = nativeWaveformPort({
      generateWaveform: () =>
        new Promise<void>((_resolve, reject) => {
          rejectGeneration = reject;
        }),
      cancelWaveform: async () => {
        rejectGeneration(Object.assign(new Error('cancelled'), { code: 'WAVEFORM_CANCELLED' }));
      },
    });
    const scheduler = new WaveformScheduler(media, repository, {
      queue: new HeavyMediaTaskQueue(),
      idFactory: () => 'waveform-job',
    });

    scheduler.schedule({ projectId: PROJECT_ID, sourceId: SOURCE_ID });
    while (repository.statuses.length === 0) await new Promise((resolve) => setImmediate(resolve));
    await scheduler.cancelAll();

    expect(repository.statuses).toEqual(['processing', 'pending']);
  });

  it('accepts only increasing progress for the matching job generation', async () => {
    const repository = new FakeWaveformRepository();
    const states = new WaveformStateRecorder();
    const progress = { listener: null as ((event: ProgressEvent) => void) | null };
    let finish!: () => void;
    const nativeDone = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const media = nativeWaveformPort({
      generateWaveform: () => nativeDone,
      addEventListener: (_eventName, listener) => {
        progress.listener = listener;
        return { remove: () => (progress.listener = null) };
      },
    });
    const scheduler = new WaveformScheduler(media, repository, {
      queue: new HeavyMediaTaskQueue(),
      idFactory: () => 'waveform-job',
      stateSink: states,
    });

    scheduler.schedule({ projectId: PROJECT_ID, sourceId: SOURCE_ID });
    while (!states.snapshots.some(({ status }) => status === 'processing')) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    progress.listener?.({
      jobId: 'waveform-job',
      operation: 'waveform',
      sequence: 2,
      stage: 'processing',
      generation: 1,
      fraction: 0.5,
    });
    progress.listener?.({
      jobId: 'waveform-job',
      operation: 'waveform',
      sequence: 1,
      stage: 'processing',
      generation: 1,
      fraction: 0.1,
    });
    progress.listener?.({
      jobId: 'waveform-job',
      operation: 'waveform',
      sequence: 3,
      stage: 'processing',
      generation: 99,
      fraction: 0.9,
    });

    expect(states.snapshots.at(-1)).toMatchObject({
      status: 'processing',
      fraction: 0.5,
      lastSequence: 2,
    });
    finish();
    await scheduler.whenIdle();
    expect(states.snapshots.at(-1)).toMatchObject({ status: 'ready', fraction: 1 });
  });
});

describe('project media deletion guard', () => {
  it('cancels import and drains waveform work before repository deletion may continue', async () => {
    const order: string[] = [];

    await prepareProjectMediaDeletion({
      coordinator: {
        cancelActive: async () => {
          order.push('import-cancelled');
        },
      },
      waveformScheduler: {
        cancelAll: async () => {
          order.push('waveform-drained');
        },
      },
    });

    expect(order).toEqual(['import-cancelled', 'waveform-drained']);
  });

  it('cancels on background but never auto-resumes on a foreground transition', async () => {
    const pause = jest.fn().mockResolvedValue(undefined);

    await handleMediaAppStateChange('background', pause);
    await handleMediaAppStateChange('active', pause);

    expect(pause).toHaveBeenCalledTimes(1);
  });
});
