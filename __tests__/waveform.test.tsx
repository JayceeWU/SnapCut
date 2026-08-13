import { fireEvent, render } from '@testing-library/react-native';

import { SelectionControls, WaveformEditor } from '@/components';
import type { WaveformFileV1 } from '@/domain';
import {
  buildWaveformFillPath,
  buildWaveformOutlinePath,
  getWaveformViewport,
  viewportXToTime,
} from '@/utils';

describe('waveform paths', () => {
  it('collapses thousands of bins into one bounded fill and outline path', () => {
    const values = Array.from({ length: 8192 }, (_, index) => (index % 100) / 100);
    const fill = buildWaveformFillPath(values, 400, 160);
    const outline = buildWaveformOutlinePath(values, 400, 160);

    expect(fill.startsWith('M ')).toBe(true);
    expect(fill.endsWith(' Z')).toBe(true);
    expect(outline.startsWith('M ')).toBe(true);
    expect((fill.match(/ L /g) ?? []).length).toBeLessThanOrEqual(2048);
  });

  it('maps viewport positions to exact integer milliseconds', () => {
    const viewport = getWaveformViewport(8192, 64_000, 4, 16_000);
    expect(viewport).toMatchObject({ startMs: 16_000, endMs: 32_000 });
    expect(viewportXToTime(250, viewport, 500)).toBe(24_000);
  });
});

describe('waveform editor UI', () => {
  const waveform: WaveformFileV1 = {
    schemaVersion: 1,
    durationMs: 30_000,
    binCount: 8192,
    rms: Array.from({ length: 8192 }, () => 0.5),
    peak: Array.from({ length: 8192 }, () => 0.75),
  };

  it('renders one RMS fill and one peak outline', async () => {
    const screen = await render(
      <WaveformEditor
        durationMs={30_000}
        endMs={10_000}
        loadState="ready"
        onEndChange={jest.fn()}
        onStartChange={jest.fn()}
        onViewportStartChange={jest.fn()}
        onZoomChange={jest.fn()}
        startMs={1_000}
        viewportStartMs={0}
        waveform={waveform}
        zoom={1}
      />,
    );

    expect(screen.getAllByTestId('waveform-rms-path')).toHaveLength(1);
    expect(screen.getAllByTestId('waveform-peak-path')).toHaveLength(1);
  });

  it('moves the nearest handle and keeps it active through a drag', async () => {
    const onStartChange = jest.fn();
    const onEndChange = jest.fn();
    const screen = await render(
      <WaveformEditor
        durationMs={30_000}
        endMs={20_000}
        loadState="ready"
        onEndChange={onEndChange}
        onStartChange={onStartChange}
        onViewportStartChange={jest.fn()}
        onZoomChange={jest.fn()}
        startMs={2_000}
        viewportStartMs={0}
        waveform={waveform}
        zoom={1}
      />,
    );
    const editor = screen.getByTestId('waveform-editor');
    await fireEvent(editor, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 180 } },
    });
    const grantTouch = {
      touchActive: true,
      currentTimeStamp: 1,
      previousTimeStamp: 0,
      currentPageX: 190,
      currentPageY: 0,
      previousPageX: 190,
      previousPageY: 0,
    };
    await fireEvent(editor, 'responderGrant', {
      nativeEvent: { locationX: 190 },
      touchHistory: {
        touchBank: [grantTouch],
        numberActiveTouches: 1,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: 1,
      },
    });
    await fireEvent(editor, 'responderMove', {
      nativeEvent: { locationX: 220 },
      touchHistory: {
        touchBank: [
          {
            ...grantTouch,
            currentTimeStamp: 2,
            currentPageX: 220,
            previousPageX: 190,
          },
        ],
        numberActiveTouches: 1,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: 2,
      },
    });

    expect(onStartChange).not.toHaveBeenCalled();
    expect(onEndChange).toHaveBeenLastCalledWith(22_000);
  });

  it('commits exact millisecond text fields', async () => {
    const onStartChange = jest.fn();
    const screen = await render(
      <SelectionControls
        endMs={10_000}
        onEndChange={jest.fn()}
        onStartChange={onStartChange}
        startMs={1_000}
      />,
    );
    const input = screen.getByLabelText('Start (ms)');
    await fireEvent(input, 'focus');
    await fireEvent.changeText(input, '1234');
    await fireEvent(input, 'blur');
    expect(onStartChange).toHaveBeenCalledWith(1234);
  });
});
