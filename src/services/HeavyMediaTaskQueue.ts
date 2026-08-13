export type HeavyMediaOperation = 'import' | 'waveform' | 'export';

export interface HeavyMediaTaskDescriptor {
  readonly operation: HeavyMediaOperation;
  readonly jobId: string;
}

/**
 * FIFO executor shared by import, waveform, and export coordinators. It keeps
 * codec-heavy work serialized without retaining media or URI data.
 */
export class HeavyMediaTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private active: HeavyMediaTaskDescriptor | null = null;

  enqueue<T>(descriptor: HeavyMediaTaskDescriptor, task: () => Promise<T>): Promise<T> {
    const run = this.tail
      .catch(() => undefined)
      .then(async () => {
        this.active = descriptor;
        try {
          return await task();
        } finally {
          if (this.active === descriptor) {
            this.active = null;
          }
        }
      });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  getActive(): HeavyMediaTaskDescriptor | null {
    return this.active === null ? null : { ...this.active };
  }

  async whenIdle(): Promise<void> {
    await this.tail;
  }
}

export const heavyMediaTaskQueue = new HeavyMediaTaskQueue();
