import { fireEvent, render } from '@testing-library/react-native';

import { ImportProgressModal } from '@/components';
import { copy } from '@/constants';
import { importFailure } from '@/services';
import { useImportStore } from '@/stores';

describe('ImportProgressModal', () => {
  beforeEach(() => useImportStore.getState().reset());

  it('shows native progress and allows cancellation before commit', async () => {
    const onCancel = jest.fn();
    useImportStore.getState().replace({
      generation: 1,
      activeJobId: 'job',
      projectId: 'project',
      sourceId: 'source',
      stage: 'extracting_or_copying',
      fraction: 0.5,
      failure: null,
      lastImportedSourceId: null,
    });
    const screen = await render(
      <ImportProgressModal onCancel={onCancel} onClose={jest.fn()} onRetry={jest.fn()} visible />,
    );

    expect(
      screen.getByText(copy.import.progress(copy.import.extracting_or_copying, 50)),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: copy.import.cancelAction }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('maps a retryable stable error to a retry action', async () => {
    const onRetry = jest.fn();
    useImportStore.getState().replace({
      generation: 1,
      activeJobId: null,
      projectId: null,
      sourceId: null,
      stage: 'failed',
      fraction: null,
      failure: importFailure('SOURCE_UNREADABLE'),
      lastImportedSourceId: null,
    });
    const screen = await render(
      <ImportProgressModal onCancel={jest.fn()} onClose={jest.fn()} onRetry={onRetry} visible />,
    );

    expect(screen.getByText('The selected file could not be read.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: copy.import.retryAction }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
