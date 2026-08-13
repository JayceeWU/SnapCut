import { fireEvent, render } from '@testing-library/react-native';

import { WaveformJobPanel } from '@/components';
import { copy } from '@/constants';
import type { WaveformJobSnapshot } from '@/stores';

const mockKeepAwake = jest.fn();

jest.mock('expo-keep-awake', () => ({
  useKeepAwake: (tag: string) => mockKeepAwake(tag),
}));

const processingJob: WaveformJobSnapshot = {
  jobId: 'waveform-job',
  projectId: 'project-id',
  sourceId: 'source-id',
  generation: 3,
  status: 'processing',
  stage: 'processing',
  fraction: 0.42,
  lastSequence: 7,
};

describe('WaveformJobPanel', () => {
  beforeEach(() => mockKeepAwake.mockClear());

  it('shows filtered progress, permits cancellation, and holds KeepAwake while visible', async () => {
    const onCancel = jest.fn();
    const screen = await render(
      <WaveformJobPanel
        job={processingJob}
        onCancel={onCancel}
        onStart={jest.fn()}
        sourceStatus="processing"
      />,
    );

    expect(screen.getByText(copy.editor.waveformProgress(42))).toBeTruthy();
    expect(screen.getByLabelText(copy.editor.waveformProgress(42))).toHaveAccessibilityValue({
      now: 42,
      min: 0,
      max: 100,
    });
    await fireEvent.press(screen.getByRole('button', { name: copy.editor.cancelWaveform }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockKeepAwake).toHaveBeenCalledWith('SnapCut waveform');
  });

  it('offers manual Resume after cancellation without holding KeepAwake', async () => {
    const onStart = jest.fn();
    const screen = await render(
      <WaveformJobPanel
        job={{ ...processingJob, status: 'pending', stage: null, fraction: null }}
        onCancel={jest.fn()}
        onStart={onStart}
        sourceStatus="pending"
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: copy.editor.resumeWaveform }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(mockKeepAwake).not.toHaveBeenCalled();
  });

  it('keeps a failed waveform retryable without hiding the committed source', async () => {
    const onStart = jest.fn();
    const screen = await render(
      <WaveformJobPanel
        job={undefined}
        onCancel={jest.fn()}
        onStart={onStart}
        sourceStatus="failed"
      />,
    );

    expect(screen.getByText(copy.editor.waveformFailed)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: copy.editor.retryWaveform }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
