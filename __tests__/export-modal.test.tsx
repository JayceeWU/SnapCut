import { fireEvent, render } from '@testing-library/react-native';

import { ExportModal } from '@/components';
import { copy } from '@/constants';
import type { ExportPreflightResult } from '@/domain';
import { useExportStore } from '@/stores';

const unavailablePlan: ExportPreflightResult['m4aPlan'] = {
  planVersion: 1,
  planId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-08-12T20:00:00.000Z',
  eligible: false,
  reasons: ['The composition contains decoded sources.'],
  codecConfigFingerprint: null,
  sampleRateHz: null,
  channelCount: null,
  maxBoundaryAdjustmentMs: 0,
  estimatedOutputBytes: null,
  sourceSnapshots: [],
  clips: [],
};

describe('ExportModal', () => {
  beforeEach(() => useExportStore.getState().reset());

  it('shows concrete disabled reasons and selects an available format', async () => {
    const onExport = jest.fn();
    useExportStore
      .getState()
      .beginPreflight(
        { projectId: 'project', jobId: 'job', generation: 1 },
        'Purple export',
        12_345,
      );
    useExportStore.getState().preflightReady({
      preferredFormat: 'flac',
      mayClip: false,
      m4aPlan: unavailablePlan,
      formats: [
        {
          format: 'm4a',
          mode: null,
          available: false,
          reasons: ['AAC stream copy is unavailable for this composition.'],
          estimatedOutputBytes: null,
          requiredFreeBytes: null,
          sampleRateHz: null,
          channelCount: null,
        },
        {
          format: 'flac',
          mode: 'flac-lossless-encode',
          available: true,
          reasons: [],
          estimatedOutputBytes: 2_000_000,
          requiredFreeBytes: 4_000_000,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
        {
          format: 'mp3',
          mode: 'mp3-lossy-encode',
          available: true,
          reasons: [],
          estimatedOutputBytes: 500_000,
          requiredFreeBytes: 1_000_000,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
      ],
    });

    const screen = await render(
      <ExportModal
        onCancel={jest.fn()}
        onClose={jest.fn()}
        onExport={onExport}
        onRetry={jest.fn()}
        onShare={jest.fn()}
        visible
      />,
    );

    expect(screen.getByText('AAC stream copy is unavailable for this composition.')).toBeTruthy();
    expect(screen.getByText(copy.export.compositionDuration('0:12'))).toBeTruthy();
    expect(screen.getByRole('radio', { name: copy.export.m4a })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: copy.export.mp3 }));
    expect(useExportStore.getState().selectedFormat).toBe('mp3');
    await fireEvent.press(screen.getByRole('button', { name: copy.export.startAction }));
    expect(onExport).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('discloses M4A access-unit adjustment and the FLAC source-quality caveat', async () => {
    useExportStore
      .getState()
      .beginPreflight(
        { projectId: 'project', jobId: 'job', generation: 1 },
        'Purple export',
        12_345,
      );
    useExportStore.getState().preflightReady({
      preferredFormat: 'm4a',
      mayClip: true,
      m4aPlan: {
        ...unavailablePlan,
        eligible: true,
        reasons: [],
        codecConfigFingerprint: 'a'.repeat(64),
        sampleRateHz: 48_000,
        channelCount: 2,
        maxBoundaryAdjustmentMs: 12,
        estimatedOutputBytes: 400_000,
      },
      formats: [
        {
          format: 'm4a',
          mode: 'aac-stream-copy',
          available: true,
          reasons: [],
          estimatedOutputBytes: 400_000,
          requiredFreeBytes: 800_000,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
        {
          format: 'flac',
          mode: 'flac-lossless-encode',
          available: true,
          reasons: [],
          estimatedOutputBytes: 2_000_000,
          requiredFreeBytes: 4_000_000,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
        {
          format: 'mp3',
          mode: 'mp3-lossy-encode',
          available: true,
          reasons: [],
          estimatedOutputBytes: 500_000,
          requiredFreeBytes: 1_000_000,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
      ],
    });

    const screen = await render(
      <ExportModal
        onCancel={jest.fn()}
        onClose={jest.fn()}
        onExport={jest.fn()}
        onRetry={jest.fn()}
        onShare={jest.fn()}
        visible
      />,
    );

    expect(screen.getByText(copy.export.m4aBoundaryAdjustment(12))).toBeTruthy();
    expect(screen.getByText(copy.export.mixClippingWarning)).toBeTruthy();
    expect(screen.getByText(copy.export.flacSourceCaveat)).toBeTruthy();
  });

  it('shows the saved location, actual duration, and M4A boundary adjustment on success', async () => {
    useExportStore.getState().complete({
      format: 'm4a',
      mode: 'aac-stream-copy',
      contentUri: 'content://media/audio/1',
      displayName: 'Purple export.m4a',
      requestedDurationMs: 12_000,
      actualDurationMs: 12_012,
      sampleRateHz: 48_000,
      channelCount: 2,
      bitrateKbps: null,
      bitsPerSample: null,
      maxBoundaryAdjustmentMs: 12,
      fileSizeBytes: 500_000,
    });

    const screen = await render(
      <ExportModal
        onCancel={jest.fn()}
        onClose={jest.fn()}
        onExport={jest.fn()}
        onRetry={jest.fn()}
        onShare={jest.fn()}
        visible
      />,
    );

    expect(screen.getByText(copy.export.successMessage('Purple export.m4a'))).toBeTruthy();
    expect(screen.getByText(copy.export.successDuration('0:12'))).toBeTruthy();
    expect(screen.getByText(copy.export.successBoundaryAdjustment(12))).toBeTruthy();
  });
});
