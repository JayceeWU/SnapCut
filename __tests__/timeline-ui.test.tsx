import { fireEvent, render } from '@testing-library/react-native';

import {
  ClipEditModal,
  CompositionWaveform,
  MediaLibraryModal,
  SequentialClipList,
  SourceNameModal,
  buildCompositionWaveformSegments,
  compositionDurationFromClips,
  validateClipRangeDraft,
  validateClipTimePartsDraft,
} from '@/components';
import type { SnapCutClip, SnapCutSource, WaveformFileV1 } from '@/domain';

const SOURCE_A_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_B_ID = '11111111-1111-4111-8111-111111111112';
const CLIP_A_ID = '11111111-1111-4111-8111-111111111113';
const CLIP_B_ID = '11111111-1111-4111-8111-111111111114';

function source(id: string, name: string, durationMs = 30_000): SnapCutSource {
  return {
    id,
    displayName: name,
    originalMimeType: null,
    sourceKind: 'm4a',
    privateAudioFileName: 'source.m4a',
    durationMs,
    codecMime: 'audio/mp4a-latm',
    sampleRateHz: 48_000,
    channelCount: 2,
    encodedBitrateBps: 192_000,
    pcmBitsPerSample: null,
    aacProfile: 'aac-lc',
    codecConfigFingerprint: null,
    encoderDelayFrames: null,
    encoderPaddingFrames: null,
    privateAudioSha256: null,
    fileSizeBytes: 2_048,
    waveformFileName: 'waveform.json',
    waveformStatus: 'ready',
    createdAt: '2026-08-13T20:00:00.000Z',
  };
}

const sourceA = source(SOURCE_A_ID, 'Interview', 40_000);
const sourceB = source(SOURCE_B_ID, 'Music', 20_000);
const clipA: SnapCutClip = {
  id: CLIP_A_ID,
  sourceId: SOURCE_A_ID,
  startMs: 10_250,
  endMs: 20_750,
};
const clipB: SnapCutClip = {
  id: CLIP_B_ID,
  sourceId: SOURCE_B_ID,
  startMs: 0,
  endMs: 5_250,
};
const waveform: WaveformFileV1 = {
  schemaVersion: 1,
  durationMs: sourceA.durationMs,
  binCount: 8192,
  rms: Array.from({ length: 8192 }, (_, index) => (index % 17) / 16),
  peak: Array.from({ length: 8192 }, () => 1),
};

describe('v7 composition waveform', () => {
  it('fits ordered clip slices by duration and leaves a placeholder for missing waveform data', () => {
    expect(compositionDurationFromClips([clipA, clipB])).toBe(15_750);
    const segments = buildCompositionWaveformSegments(
      [clipA, clipB],
      [sourceA, sourceB],
      { [sourceA.id]: waveform, [sourceB.id]: null },
      315,
      120,
    );

    expect(segments[0]).toMatchObject({
      clipId: clipA.id,
      x: 0,
      width: 210,
      path: expect.any(String),
    });
    expect(segments[1]).toMatchObject({ clipId: clipB.id, x: 210, width: 105, path: null });
  });

  it('pauses at drag start, updates the cursor, and emits one final seek', async () => {
    const onScrubStart = jest.fn();
    const onScrubChange = jest.fn();
    const onScrubEnd = jest.fn();
    const screen = await render(
      <CompositionWaveform
        clips={[clipA, clipB]}
        cursorMs={0}
        onScrubChange={onScrubChange}
        onScrubEnd={onScrubEnd}
        onScrubStart={onScrubStart}
        sources={[sourceA, sourceB]}
        waveformsBySourceId={{ [sourceA.id]: waveform }}
      />,
    );
    const view = screen.getByTestId('composition-waveform');
    await fireEvent(view, 'layout', { nativeEvent: { layout: { width: 300, height: 132 } } });
    await fireEvent(view, 'touchStart', { nativeEvent: { locationX: 75 } });
    await fireEvent(view, 'touchMove', { nativeEvent: { locationX: 150 } });
    await fireEvent(view, 'touchEnd', { nativeEvent: { locationX: 225 } });

    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onScrubChange).toHaveBeenCalledWith(7_875);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
    expect(onScrubEnd).toHaveBeenCalledWith(11_813);
  });

  it('does not expose zoom, tracks, fades, volume, or split controls', async () => {
    const screen = await render(
      <CompositionWaveform
        clips={[clipA]}
        cursorMs={0}
        onScrubChange={jest.fn()}
        onScrubEnd={jest.fn()}
        onScrubStart={jest.fn()}
        sources={[sourceA]}
        waveformsBySourceId={{ [sourceA.id]: waveform }}
      />,
    );
    expect(screen.queryByText('Track 1')).toBeNull();
    expect(screen.queryByText('Track 2')).toBeNull();
    expect(screen.queryByText('Fade')).toBeNull();
    expect(screen.queryByText('Volume')).toBeNull();
    expect(screen.queryByText('Split')).toBeNull();
    expect(screen.queryByText('Zoom')).toBeNull();
  });
});

describe('sequential clip list', () => {
  it('shows compact ordered rows with exact minute-based times', async () => {
    const screen = await render(
      <SequentialClipList
        clips={[clipA, clipB]}
        onEdit={jest.fn()}
        onReorder={jest.fn()}
        sources={[sourceA, sourceB]}
      />,
    );
    expect(screen.getByText('Clip 1')).toBeTruthy();
    expect(screen.getByText('Interview')).toBeTruthy();
    expect(screen.getByText('Start 0:10.250')).toBeTruthy();
    expect(screen.getByText('End 0:20.750')).toBeTruthy();
    expect(screen.getByTestId(`clip-drag-handle-${clipA.id}`).props.style).toMatchObject({
      width: 48,
    });
  });

  it('supports TalkBack move earlier/later and opens a row for editing', async () => {
    const onEdit = jest.fn();
    const onReorder = jest.fn();
    const screen = await render(
      <SequentialClipList
        clips={[clipA, clipB]}
        onEdit={onEdit}
        onReorder={onReorder}
        sources={[sourceA, sourceB]}
      />,
    );
    await fireEvent(screen.getByTestId(`clip-drag-handle-${clipB.id}`), 'accessibilityAction', {
      nativeEvent: { actionName: 'moveEarlier' },
    });
    expect(onReorder).toHaveBeenCalledWith(clipB.id, 0);

    await fireEvent.press(screen.getByRole('button', { name: /Edit Clip 1/ }));
    expect(onEdit).toHaveBeenCalledWith(clipA);
  });
});

describe('precise clip editor', () => {
  it('accepts all supported exact time forms and enforces source bounds and 100ms minimum', () => {
    expect(validateClipRangeDraft(sourceA.id, '10.250', '0:20.750', [sourceA])).toEqual({
      value: { sourceId: sourceA.id, startMs: 10_250, endMs: 20_750 },
      message: null,
    });
    expect(validateClipRangeDraft(sourceA.id, '0:10.000', '0:10.099', [sourceA]).message).toBe(
      'Choose at least 0.100 seconds.',
    );
    expect(validateClipRangeDraft(sourceA.id, '0:10.000', '1:00.000', [sourceA]).message).toBe(
      'End cannot be later than 0:40.000.',
    );
    expect(
      validateClipTimePartsDraft(
        sourceA.id,
        { minutes: '0', seconds: '10', milliseconds: '250' },
        { minutes: '0', seconds: '20', milliseconds: '750' },
        [sourceA],
      ),
    ).toEqual({
      value: { sourceId: sourceA.id, startMs: 10_250, endMs: 20_750 },
      message: null,
    });
    expect(
      validateClipTimePartsDraft(
        sourceA.id,
        { minutes: '0', seconds: '60', milliseconds: '000' },
        { minutes: '1', seconds: '01', milliseconds: '000' },
        [sourceA],
      ).message,
    ).toBe('Enter minutes, seconds, and milliseconds using numbers.');
  });

  it('resets to the full source when source changes and has no preview', async () => {
    const onSave = jest.fn();
    const screen = await render(
      <ClipEditModal
        clip={clipA}
        onCancel={jest.fn()}
        onDelete={jest.fn()}
        onSave={onSave}
        sources={[sourceA, sourceB]}
        visible
      />,
    );
    await fireEvent.press(screen.getByRole('radio', { name: /Music/ }));
    expect(screen.getByTestId('clip-start-minutes-input').props.value).toBe('0');
    expect(screen.getByTestId('clip-start-seconds-input').props.value).toBe('00');
    expect(screen.getByTestId('clip-start-milliseconds-input').props.value).toBe('000');
    expect(screen.getByTestId('clip-end-minutes-input').props.value).toBe('0');
    expect(screen.getByTestId('clip-end-seconds-input').props.value).toBe('20');
    expect(screen.getByTestId('clip-end-milliseconds-input').props.value).toBe('000');
    expect(screen.getAllByText('M')).toHaveLength(2);
    expect(screen.getAllByText('SS')).toHaveLength(2);
    expect(screen.getAllByText('mmm')).toHaveLength(2);
    expect(screen.queryByText(/Preview/u)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ sourceId: sourceB.id, startMs: 0, endMs: 20_000 });
  });

  it('saves separately entered minute, second, and millisecond fields exactly', async () => {
    const onSave = jest.fn();
    const screen = await render(
      <ClipEditModal onCancel={jest.fn()} onSave={onSave} sources={[sourceA]} visible />,
    );

    await fireEvent.changeText(screen.getByLabelText('Start minutes'), '0');
    await fireEvent.changeText(screen.getByLabelText('Start seconds'), '12');
    await fireEvent.changeText(screen.getByLabelText('Start milliseconds'), '345');
    await fireEvent.changeText(screen.getByLabelText('End minutes'), '0');
    await fireEvent.changeText(screen.getByLabelText('End seconds'), '20');
    await fireEvent.changeText(screen.getByLabelText('End milliseconds'), '678');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ sourceId: sourceA.id, startMs: 12_345, endMs: 20_678 });
  });

  it('keeps the clip dialog open and shows a native preview release failure inside it', async () => {
    const screen = await render(
      <ClipEditModal
        clip={clipA}
        onCancel={jest.fn()}
        onSave={jest.fn()}
        operationError="The native preview player could not be released."
        sources={[sourceA]}
        visible
      />,
    );

    expect(screen.getByTestId('clip-editor-dialog')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('The native preview player could not be released.')).toBeTruthy();
  });
});

describe('source naming', () => {
  it('keeps the naming dialog open and shows a rename failure inside it', async () => {
    const screen = await render(
      <SourceNameModal
        initialName="Interview"
        onCancel={jest.fn()}
        onSubmit={jest.fn()}
        operationError="The source could not be renamed."
        visible
      />,
    );

    expect(screen.getByTestId('source-name-dialog')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('The source could not be renamed.')).toBeTruthy();
  });
});

describe('media library', () => {
  const baseProps = () => ({
    importBusy: false,
    onAddClip: jest.fn(),
    onClose: jest.fn(),
    onDelete: jest.fn(),
    onImport: jest.fn(),
    onPreview: jest.fn(),
    onRename: jest.fn(),
    previewLoading: false,
    previewPlaying: false,
    previewSourceId: null,
    sources: [sourceA],
    visible: true,
  });

  it('closes from the backdrop but not an internal press', async () => {
    const props = baseProps();
    const screen = await render(<MediaLibraryModal {...props} />);
    await fireEvent.press(screen.getByTestId('media-library-dialog'), {
      stopPropagation: jest.fn(),
    });
    expect(props.onClose).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('media-library-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('offers only import, preview, rename, add clip and safe source deletion', async () => {
    const props = baseProps();
    const screen = await render(
      <MediaLibraryModal {...props} inUseSourceIds={new Set([sourceA.id])} />,
    );
    expect(screen.getByRole('button', { name: `Preview ${sourceA.displayName}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Rename ${sourceA.displayName}` })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `Add clip from ${sourceA.displayName}` }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: `Delete ${sourceA.displayName}` })).toBeDisabled();
    expect(screen.queryByText('Details')).toBeNull();
    expect(screen.queryByText('Trim & Place')).toBeNull();
    expect(screen.queryByText(/Track 1/u)).toBeNull();
  });

  it('keeps the media dialog open and shows a delete failure inside it', async () => {
    const props = baseProps();
    const screen = await render(
      <MediaLibraryModal {...props} operationError="The source could not be deleted." />,
    );

    expect(screen.getByTestId('media-library-dialog')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('The source could not be deleted.')).toBeTruthy();
  });

  it('keeps a source preview rejection visible inside the media dialog', async () => {
    const props = baseProps();
    const screen = await render(<MediaLibraryModal {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: `Preview ${sourceA.displayName}` }));
    expect(props.onPreview).toHaveBeenCalledWith(sourceA);

    await screen.rerender(
      <MediaLibraryModal {...props} operationError="Preview could not be played." />,
    );
    expect(screen.getByTestId('media-library-dialog')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Preview could not be played.')).toBeTruthy();
  });
});
