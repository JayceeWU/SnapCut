import { fireEvent, render } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import {
  ClipEditModal,
  CompositionWaveform,
  CrossfadeModal,
  MediaLibraryModal,
  SequentialClipList,
  SourceComparisonModal,
  SourceNameModal,
  buildCompositionWaveformSegments,
  compositionDurationFromClips,
  validateClipRangeDraft,
  validateClipTimePartsDraft,
} from '@/components';
import type { SnapCutClip, SnapCutSource, WaveformFile } from '@/domain';

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

const sourceA = source(SOURCE_A_ID, 'Voice', 40_000);
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
const waveform: WaveformFile = {
  schemaVersion: 1,
  durationMs: sourceA.durationMs,
  binCount: 8192,
  rms: Array.from({ length: 8192 }, (_, index) => (index % 17) / 16),
  peak: Array.from({ length: 8192 }, () => 1),
};

describe('composition waveform', () => {
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
    expect(screen.getByText('Voice')).toBeTruthy();
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

  it('renders a compact editable crossfade boundary row', async () => {
    const onEditCrossfade = jest.fn();
    const onDeleteCrossfade = jest.fn();
    const crossfade = {
      id: '11111111-1111-4111-8111-111111111119',
      leftClipId: clipA.id,
      rightClipId: clipB.id,
      durationMs: 2_000 as const,
    };
    const screen = await render(
      <SequentialClipList
        clips={[clipA, clipB]}
        crossfades={[crossfade]}
        onDeleteCrossfade={onDeleteCrossfade}
        onEdit={jest.fn()}
        onEditCrossfade={onEditCrossfade}
        onReorder={jest.fn()}
        sources={[sourceA, sourceB]}
      />,
    );
    expect(screen.getByText('Crossfade 2s')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Edit 2 second crossfade/ }));
    expect(onEditCrossfade).toHaveBeenCalledWith(crossfade);
    await fireEvent.press(screen.getByRole('button', { name: /Delete crossfade/ }));
    expect(onDeleteCrossfade).toHaveBeenCalledWith(crossfade.id);
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

  it('scrubs the full source, plays from the cursor, and sets an exact boundary', async () => {
    const onPausePreview = jest.fn();
    const onPreview = jest.fn();
    const onSeekPreview = jest.fn();
    const screen = await render(
      <ClipEditModal
        clip={clipA}
        onCancel={jest.fn()}
        onPausePreview={onPausePreview}
        onPreview={onPreview}
        onSave={jest.fn()}
        onSeekPreview={onSeekPreview}
        sources={[sourceA]}
        visible
        waveformsBySourceId={{ [sourceA.id]: waveform }}
      />,
    );
    const sourceWaveform = screen.getByTestId('clip-source-waveform');
    await fireEvent(sourceWaveform, 'layout', {
      nativeEvent: { layout: { width: 400, height: 96 } },
    });
    await fireEvent(sourceWaveform, 'touchStart', { nativeEvent: { locationX: 150 } });
    await fireEvent(sourceWaveform, 'touchEnd', { nativeEvent: { locationX: 150 } });
    expect(onPausePreview).toHaveBeenCalledTimes(1);
    expect(onSeekPreview).toHaveBeenCalledWith(15_000);
    expect(screen.getByTestId('clip-source-cursor-time')).toHaveTextContent('0:15.000');
    await fireEvent.press(screen.getByRole('button', { name: 'Set end to play position' }));
    expect(screen.getByTestId('clip-end-minutes-input').props.value).toBe('0');
    expect(screen.getByTestId('clip-end-seconds-input').props.value).toBe('15');
    expect(screen.getByTestId('clip-end-milliseconds-input').props.value).toBe('000');
    await fireEvent.press(screen.getByRole('button', { name: 'Play source from cursor' }));
    expect(onPreview).toHaveBeenCalledWith(sourceA, 15_000);
  });

  it('uses a keyboard-adjusting scroll layout so End and actions remain reachable', async () => {
    const screen = await render(
      <ClipEditModal onCancel={jest.fn()} onSave={jest.fn()} sources={[sourceA]} visible />,
    );
    expect(screen.getByTestId('clip-editor-dialog')).toBeTruthy();
    expect(screen.getByTestId('clip-end-minutes-input')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('offers only supported crossfade choices and returns the selected duration', async () => {
    const onSave = jest.fn();
    const screen = await render(
      <CrossfadeModal
        availableDurationsMs={[1_000, 2_000, 4_000]}
        busy={false}
        onCancel={jest.fn()}
        onSave={onSave}
        visible
      />,
    );
    expect(
      screen.getByRole('radio', { name: '6 second crossfade' }).props.accessibilityState,
    ).toEqual({
      checked: false,
      disabled: true,
    });
    await fireEvent.press(screen.getByRole('radio', { name: '4 second crossfade' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(4_000);
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
        initialName="Voice"
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
    onClose: jest.fn(),
    onCompare: jest.fn(),
    onDelete: jest.fn(),
    onImport: jest.fn(),
    onPreview: jest.fn(),
    onRename: jest.fn(),
    previewLoading: false,
    previewPlaying: false,
    previewSourceId: null,
    compareReadySourceIds: new Set([sourceA.id]),
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

  it('shows Sources without explanatory copy and uses one icon-only action row', async () => {
    const props = baseProps();
    const screen = await render(
      <MediaLibraryModal {...props} inUseSourceIds={new Set([sourceA.id])} />,
    );
    expect(screen.getByRole('header', { name: 'Sources' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Media' })).toBeNull();
    expect(screen.queryByText('Preview sources or add a range to Clips.')).toBeNull();
    expect(
      screen.queryByRole('button', { name: `Add clip from ${sourceA.displayName}` }),
    ).toBeNull();
    expect(screen.queryByText('Add Clip')).toBeNull();
    expect(screen.queryByText('Rename')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.queryByText('In use')).toBeNull();

    const preview = screen.getByRole('button', { name: `Preview ${sourceA.displayName}` });
    const compare = screen.getByRole('button', { name: `Compare ${sourceA.displayName}` });
    const rename = screen.getByRole('button', { name: `Rename ${sourceA.displayName}` });
    const remove = screen.getByRole('button', { name: `Delete ${sourceA.displayName}` });
    const sourceCard = screen.getByTestId(`source-card-${sourceA.id}`);
    const sourceCopy = screen.getByTestId(`source-copy-${sourceA.id}`);
    const sourceActions = screen.getByTestId(`source-actions-${sourceA.id}`);
    const sourceName = screen.getByText(sourceA.displayName);
    expect(StyleSheet.flatten(sourceCard.props.style)).toMatchObject({
      flexDirection: 'row',
      alignItems: 'center',
    });
    expect(StyleSheet.flatten(sourceCopy.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(sourceName.props).toMatchObject({ ellipsizeMode: 'tail', numberOfLines: 1 });
    expect(StyleSheet.flatten(sourceActions.props.style)).toMatchObject({
      flexDirection: 'row',
      flexShrink: 0,
    });
    expect(
      sourceActions.props.children.map(
        (child: { props?: { testID?: string } }) => child.props?.testID,
      ),
    ).toEqual([
      `source-preview-action-${sourceA.id}`,
      `source-compare-action-${sourceA.id}`,
      `source-rename-action-${sourceA.id}`,
      `source-delete-action-${sourceA.id}`,
    ]);
    expect(screen.getByTestId(`source-preview-action-${sourceA.id}`).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 48, height: 48 })]),
    );
    expect(screen.getByTestId(`source-compare-action-${sourceA.id}`).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 48, height: 48 })]),
    );
    expect(screen.getByTestId(`source-rename-action-${sourceA.id}`).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 48, height: 48 })]),
    );
    expect(screen.getByTestId(`source-delete-action-${sourceA.id}`).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 48, height: 48 })]),
    );
    expect(preview).toBeEnabled();
    expect(compare).toBeEnabled();
    await fireEvent.press(compare);
    expect(props.onCompare).toHaveBeenCalledWith(sourceA);
    expect(rename).toBeEnabled();
    expect(remove).toBeDisabled();
    expect(screen.queryByText('Details')).toBeNull();
    expect(screen.queryByText('Trim & Place')).toBeNull();
    expect(screen.queryByText(/Track 1/u)).toBeNull();
  });

  it('disables Compare until the source waveform is ready', async () => {
    const props = baseProps();
    const screen = await render(<MediaLibraryModal {...props} compareReadySourceIds={new Set()} />);
    expect(screen.getByRole('button', { name: `Compare ${sourceA.displayName}` })).toBeDisabled();
  });

  it('switches the preview action to Pause and keeps unused-source deletion confirmed', async () => {
    const props = baseProps();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const screen = await render(
      <MediaLibraryModal {...props} previewPlaying previewSourceId={sourceA.id} />,
    );

    expect(screen.getByRole('button', { name: `Pause ${sourceA.displayName}` })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: `Rename ${sourceA.displayName}` }));
    expect(props.onRename).toHaveBeenCalledWith(sourceA);
    await fireEvent.press(screen.getByRole('button', { name: `Delete ${sourceA.displayName}` }));
    expect(alert).toHaveBeenCalledWith(
      'Delete source?',
      expect.stringContaining(sourceA.displayName),
      expect.any(Array),
    );
    alert.mockRestore();
  });

  it('disables all source actions while preview loading or deletion is active', async () => {
    const props = baseProps();
    const screen = await render(
      <MediaLibraryModal {...props} previewLoading previewSourceId={sourceA.id} />,
    );

    expect(
      screen.getByRole('button', { name: `Loading ${sourceA.displayName} preview` }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: `Rename ${sourceA.displayName}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Delete ${sourceA.displayName}` })).toBeDisabled();

    await screen.rerender(<MediaLibraryModal {...props} deletingSourceId={sourceA.id} />);
    expect(screen.getByRole('button', { name: `Preview ${sourceA.displayName}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Rename ${sourceA.displayName}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Delete ${sourceA.displayName}` })).toBeDisabled();
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

describe('source comparison', () => {
  const baseProps = () => ({
    bookmark: null,
    onAddClips: jest.fn(),
    onClose: jest.fn(),
    onInteractionStart: jest.fn(),
    onPreview: jest.fn(),
    onResultPreview: jest.fn(),
    onResultScrubEnd: jest.fn(),
    onResultScrubStart: jest.fn(),
    onSet: jest.fn(async () => true),
    source: sourceA,
    visible: true,
    waveform,
  });

  it('renders two synchronized local waveforms, fixed playhead, and disabled saved actions', async () => {
    const props = baseProps();
    const screen = await render(<SourceComparisonModal {...props} />);
    expect(screen.getByTestId('comparison-first-waveform')).toBeTruthy();
    expect(screen.getByTestId('comparison-second-waveform')).toBeTruthy();
    expect(screen.getByTestId('comparison-playhead')).toBeTruthy();
    expect(screen.getByTestId('comparison-result-waveform')).toBeTruthy();
    expect(screen.getByTestId('comparison-span-value')).toHaveTextContent('10s');
    expect(screen.getByRole('button', { name: 'Restore saved comparison points' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add comparison clips' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview comparison' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Play comparison result' })).toBeEnabled();
  });

  it('selects only whole-second shared intervals capped at ten seconds', async () => {
    const props = baseProps();
    const screen = await render(<SourceComparisonModal {...props} />);
    const slider = screen.getByTestId('comparison-span-slider');
    await fireEvent(slider, 'layout', { nativeEvent: { layout: { width: 300, height: 48 } } });
    await fireEvent(slider, 'touchStart', { nativeEvent: { locationX: 100 } });
    expect(screen.getByTestId('comparison-span-value')).toHaveTextContent('4s');
    expect(props.onInteractionStart).toHaveBeenCalledTimes(1);
  });

  it('moves a local waveform with a stable drag anchor and resets result playback before the seam', async () => {
    const props = baseProps();
    const screen = await render(<SourceComparisonModal {...props} />);
    const firstWaveform = screen.getByTestId('comparison-first-waveform');
    await fireEvent(firstWaveform, 'layout', {
      nativeEvent: { layout: { width: 300, height: 78 } },
    });
    await fireEvent(firstWaveform, 'touchStart', { nativeEvent: { locationX: 150 } });
    await fireEvent(firstWaveform, 'touchMove', { nativeEvent: { locationX: 180 } });
    await fireEvent(firstWaveform, 'touchEnd', { nativeEvent: { locationX: 180 } });
    await fireEvent.press(screen.getByRole('button', { name: 'Set comparison points' }));
    expect(props.onInteractionStart).toHaveBeenCalledTimes(1);
    expect(props.onSet).toHaveBeenCalledWith(12_333, 26_667);
    await fireEvent.press(screen.getByRole('button', { name: 'Play comparison result' }));
    expect(props.onResultPreview).toHaveBeenCalledWith(12_333, 26_667, 9_333);
  });

  it('scrubs the full splice once and starts result playback from the white line', async () => {
    const props = baseProps();
    const screen = await render(<SourceComparisonModal {...props} />);
    const result = screen.getByTestId('comparison-result-waveform');
    await fireEvent(result, 'layout', { nativeEvent: { layout: { width: 300, height: 68 } } });
    await fireEvent(result, 'touchStart', { nativeEvent: { locationX: 75 } });
    await fireEvent(result, 'touchMove', { nativeEvent: { locationX: 150 } });
    await fireEvent(result, 'touchEnd', { nativeEvent: { locationX: 225 } });
    expect(props.onResultScrubStart).toHaveBeenCalledTimes(1);
    expect(props.onResultScrubEnd).toHaveBeenCalledTimes(1);
    expect(props.onResultScrubEnd).toHaveBeenCalledWith(20_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Play comparison result' }));
    expect(props.onResultPreview).toHaveBeenCalledWith(13_333, 26_667, 20_000);
  });

  it('moves the white line from native progress for result playback', async () => {
    const props = baseProps();
    const screen = await render(
      <SourceComparisonModal {...props} previewKind="result" selectionPlaybackPositionMs={5_000} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Play comparison result' }));
    expect(props.onResultPreview).toHaveBeenCalledWith(13_333, 26_667, 5_000);
  });

  it('maps transition playback progress onto the complete-result white line', async () => {
    const props = baseProps();
    const screen = await render(
      <SourceComparisonModal
        {...props}
        previewKind="transition"
        selectionPlaybackPositionMs={7_000}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Play comparison result' }));
    expect(props.onResultPreview).toHaveBeenCalledWith(13_333, 26_667, 15_333);
    expect(screen.getByTestId('comparison-result-source-time')).toHaveTextContent('0:28.667');
  });

  it('shows the white line original source time below the result play button', async () => {
    const props = baseProps();
    const screen = await render(
      <SourceComparisonModal
        {...props}
        bookmark={{ sourceId: sourceA.id, firstMs: 8_000, secondMs: 24_000 }}
        previewKind="result"
        selectionPlaybackPositionMs={10_000}
      />,
    );
    expect(screen.getByTestId('comparison-result-source-time')).toHaveTextContent('0:26.000');
  });

  it('moves the two global positions independently and sets the current pair', async () => {
    const props = baseProps();
    const screen = await render(<SourceComparisonModal {...props} />);
    const first = screen.getByTestId('comparison-first-overview');
    const second = screen.getByTestId('comparison-second-overview');
    await fireEvent(first, 'layout', { nativeEvent: { layout: { width: 300, height: 48 } } });
    await fireEvent(second, 'layout', { nativeEvent: { layout: { width: 300, height: 48 } } });
    await fireEvent(first, 'touchStart', { nativeEvent: { locationX: 75 } });
    await fireEvent(second, 'touchStart', { nativeEvent: { locationX: 225 } });
    await fireEvent.press(screen.getByRole('button', { name: 'Set comparison points' }));
    expect(props.onInteractionStart).toHaveBeenCalledTimes(2);
    expect(props.onSet).toHaveBeenCalledWith(10_000, 30_000);
  });

  it('restores a saved pair, previews it, and delegates Add Clips', async () => {
    const props = baseProps();
    const bookmark = { sourceId: sourceA.id, firstMs: 8_000, secondMs: 24_000 };
    const screen = await render(<SourceComparisonModal {...props} bookmark={bookmark} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Restore saved comparison points' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Preview comparison' }));
    expect(props.onPreview).toHaveBeenCalledWith(8_000, 24_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Add comparison clips' }));
    expect(props.onAddClips).toHaveBeenCalledWith(bookmark);
  });
});
