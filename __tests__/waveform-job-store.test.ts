import {
  resetWaveformJobStore,
  useWaveformJobStore,
  waveformJobKey,
  type WaveformJobSnapshot,
} from '@/stores';

const snapshot: WaveformJobSnapshot = {
  jobId: 'job-1',
  projectId: 'project-1',
  sourceId: 'source-1',
  generation: 1,
  status: 'processing',
  stage: 'processing',
  fraction: 0.25,
  lastSequence: 1,
};

describe('waveform job store', () => {
  beforeEach(resetWaveformJobStore);

  it('keeps only small job metadata and resets terminal state reliably', () => {
    useWaveformJobStore.getState().publish(snapshot);
    expect(useWaveformJobStore.getState().jobs[waveformJobKey('project-1', 'source-1')]).toEqual(
      snapshot,
    );
    expect(JSON.stringify(useWaveformJobStore.getState().jobs)).not.toContain('file://');

    useWaveformJobStore.getState().clear('project-1', 'source-1');
    expect(useWaveformJobStore.getState().jobs).toEqual({});

    useWaveformJobStore.getState().publish(snapshot);
    resetWaveformJobStore();
    expect(useWaveformJobStore.getState().jobs).toEqual({});
  });
});
