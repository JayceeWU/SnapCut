import { create } from 'zustand';

export type WaveformJobStatus =
  'queued' | 'processing' | 'cancelling' | 'pending' | 'ready' | 'failed';

export interface WaveformJobSnapshot {
  readonly jobId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly generation: number;
  readonly status: WaveformJobStatus;
  readonly stage: 'queued' | 'processing' | 'writing' | 'complete' | null;
  readonly fraction: number | null;
  readonly lastSequence: number;
}

export interface WaveformJobStateSink {
  publish(snapshot: WaveformJobSnapshot): void;
  clear(projectId: string, sourceId: string): void;
  clearAll(): void;
}

interface WaveformJobState {
  readonly jobs: Readonly<Record<string, WaveformJobSnapshot>>;
  publish: (snapshot: WaveformJobSnapshot) => void;
  clear: (projectId: string, sourceId: string) => void;
  clearAll: () => void;
}

export function waveformJobKey(projectId: string, sourceId: string): string {
  return `${projectId}:${sourceId}`;
}

export const useWaveformJobStore = create<WaveformJobState>((set) => ({
  jobs: {},
  publish: (snapshot) => {
    set((state) => ({
      jobs: {
        ...state.jobs,
        [waveformJobKey(snapshot.projectId, snapshot.sourceId)]: snapshot,
      },
    }));
  },
  clear: (projectId, sourceId) => {
    set((state) => {
      const key = waveformJobKey(projectId, sourceId);
      if (!(key in state.jobs)) return state;
      const jobs = { ...state.jobs };
      delete jobs[key];
      return { jobs };
    });
  },
  clearAll: () => set({ jobs: {} }),
}));

export const waveformJobStateSink: WaveformJobStateSink = {
  publish(snapshot) {
    useWaveformJobStore.getState().publish(snapshot);
  },
  clear(projectId, sourceId) {
    useWaveformJobStore.getState().clear(projectId, sourceId);
  },
  clearAll() {
    useWaveformJobStore.getState().clearAll();
  },
};

export function resetWaveformJobStore(): void {
  useWaveformJobStore.getState().clearAll();
}
