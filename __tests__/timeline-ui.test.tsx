import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import {
  OVERVIEW_HANDLE_HIT_WIDTH,
  ClipActionRail,
  ClipInlineAdjustment,
  LiveClipActionRail,
  MediaLibraryModal,
  ProjectTimeline,
  TimelineOverview,
  acknowledgedCompositionPausePosition,
  editorWorkspaceLayout,
  mate20EditorBudget,
  selectedFadeWorkspaceHeight,
} from '@/components';
import type { SnapCutClip, SnapCutSource, WaveformFileV1 } from '@/domain';
import { usePlaybackStore } from '@/stores';
import {
  getCenteredTimelineViewport,
  projectContainsCommittedSourceClip,
  projectTimelineDurationMs,
  sampleTimelineClipWaveform,
  timelineFadeGeometry,
  timelineTrimDraft,
  visualFadeEnvelope,
} from '@/utils';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const CLIP_A_ID = '11111111-1111-4111-8111-111111111112';
const CLIP_B_ID = '11111111-1111-4111-8111-111111111113';

const source: SnapCutSource = {
  id: SOURCE_ID,
  displayName: 'Source 1',
  originalMimeType: null,
  sourceKind: 'm4a',
  privateAudioFileName: 'source.m4a',
  durationMs: 30_000,
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

const clipA: SnapCutClip = {
  id: CLIP_A_ID,
  sourceId: SOURCE_ID,
  startMs: 0,
  endMs: 10_000,
  trackId: 'track-1',
  timelineStartMs: 0,
  gain: 0.5,
  fadeInMs: 1_000,
  fadeOutMs: 1_000,
};

const clipB: SnapCutClip = {
  ...clipA,
  id: CLIP_B_ID,
  startMs: 10_000,
  endMs: 20_000,
  trackId: 'track-2',
  timelineStartMs: 5_000,
  gain: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
};

const waveform: WaveformFileV1 = {
  schemaVersion: 1,
  durationMs: source.durationMs,
  binCount: 8192,
  rms: Array.from({ length: 8192 }, () => 0.8),
  peak: Array.from({ length: 8192 }, () => 1),
};

const timelineProps = () => ({
  clips: [clipA, clipB],
  cursorMs: 5_000,
  onEditStart: jest.fn(),
  onMoveClip: jest.fn(),
  onScrubChange: jest.fn(),
  onScrubEnd: jest.fn(),
  onScrubStart: jest.fn(),
  onSelectClip: jest.fn(),
  onSelectTrack: jest.fn(),
  onTrimClipEdge: jest.fn(),
  selectedClipId: clipA.id,
  selectedTrackId: 'track-1' as const,
  sources: [source],
  visibleSpanMs: 10_000,
  waveformsBySourceId: { [source.id]: waveform },
});

describe('project timeline geometry', () => {
  it('uses absolute two-track time and virtual padding around a fixed cursor', () => {
    expect(projectTimelineDurationMs([clipA, clipB])).toBe(15_000);
    expect(getCenteredTimelineViewport(60_000, 30_000, 0)).toEqual({
      startMs: -15_000,
      endMs: 15_000,
      durationMs: 30_000,
    });
    expect(getCenteredTimelineViewport(60_000, 30_000, 60_000)).toEqual({
      startMs: 45_000,
      endMs: 75_000,
      durationMs: 30_000,
    });
  });

  it('requires both source and automatically placed clip before dismissing import', () => {
    const baseProject = {
      schemaVersion: 6 as const,
      id: '11111111-1111-4111-8111-111111111119',
      name: 'Import',
      namePromptCompleted: false,
      createdAt: '2026-08-13T20:00:00.000Z',
      updatedAt: '2026-08-13T20:00:00.000Z',
      sources: [source],
      trackCount: 2 as const,
      clips: [],
      lastExport: null,
    };
    expect(projectContainsCommittedSourceClip(baseProject, source.id)).toBe(false);
    expect(projectContainsCommittedSourceClip({ ...baseProject, clips: [clipA] }, source.id)).toBe(
      true,
    );
  });

  it('applies gain and equal-power fades to the visual waveform', () => {
    expect(visualFadeEnvelope(clipA, 0)).toBeCloseTo(0);
    expect(visualFadeEnvelope(clipA, 500)).toBeCloseTo(Math.sin(Math.PI / 4) * 0.5);
    expect(visualFadeEnvelope(clipA, 5_000)).toBeCloseTo(0.5);
    expect(visualFadeEnvelope(clipA, 10_000)).toBeCloseTo(0);
    expect(sampleTimelineClipWaveform(clipA, source, waveform, 32)).toHaveLength(32);
  });

  it('maps fade masks and fits trimmed fades to 500ms steps', () => {
    expect(timelineFadeGeometry(clipA, 0, 10_000, 200)).toEqual({
      fadeIn: { left: 0, width: 20, handleX: 20 },
      fadeOut: { left: 180, width: 20, handleX: 180 },
    });
    const previous = { ...clipA, id: CLIP_B_ID, timelineStartMs: 0, endMs: 2_000 };
    const faded = {
      ...clipA,
      timelineStartMs: 2_000,
      startMs: 0,
      endMs: 4_000,
      fadeInMs: 3_500 as const,
      fadeOutMs: 500 as const,
    };
    expect(
      timelineTrimDraft(faded, source.durationMs, 'left', 5_000, 100, [previous, faded]),
    ).toMatchObject({
      startMs: 3_000,
      timelineStartMs: 5_000,
      fadeInMs: 500,
      fadeOutMs: 500,
    });
  });
});

describe('fixed-playhead timeline', () => {
  it('fits the selected Fade workspace inside a conservative Mate 20 safe area', () => {
    expect(
      editorWorkspaceLayout.timelineRulerHeight +
        editorWorkspaceLayout.timelineTrackHeight * 2 +
        editorWorkspaceLayout.timelineLowerScrubHeight,
    ).toBe(editorWorkspaceLayout.timelineStageHeight);
    expect(editorWorkspaceLayout.minimumTouchHeight).toBeGreaterThanOrEqual(48);
    expect(editorWorkspaceLayout.transportControlHeight).toBeGreaterThanOrEqual(48);
    expect(editorWorkspaceLayout.overviewHeight).toBeGreaterThanOrEqual(48);
    expect(editorWorkspaceLayout.inlineSliderHeight).toBeGreaterThanOrEqual(48);
    expect(mate20EditorBudget.safeWorkspaceHeight).toBe(
      mate20EditorBudget.viewportHeight - mate20EditorBudget.reservedSystemAndSafeAreaHeight,
    );
    expect(selectedFadeWorkspaceHeight).toBe(602);
    expect(selectedFadeWorkspaceHeight).toBeLessThanOrEqual(mate20EditorBudget.safeWorkspaceHeight);
  });

  it('renders the exact 80/56/56/56 stage with one full-height centered playhead', async () => {
    const screen = await render(<ProjectTimeline {...timelineProps()} />);
    await fireEvent(screen.getByTestId('timeline-gesture-stage'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 328, height: 248 } },
    });

    expect(screen.getByTestId('timeline-track-1')).toBeTruthy();
    expect(screen.getByTestId('timeline-track-2')).toBeTruthy();
    expect(screen.getByTestId(`timeline-clip-waveform-${clipA.id}`)).toBeTruthy();
    expect(screen.getByTestId(`timeline-clip-left-handle-${clipA.id}`)).toBeTruthy();
    expect(screen.getByTestId(`timeline-clip-right-handle-${clipA.id}`)).toBeTruthy();
    expect(
      StyleSheet.flatten(screen.getByTestId('timeline-gesture-stage').props.style),
    ).toMatchObject({ height: 248 });
    expect(
      StyleSheet.flatten(screen.getByTestId('timeline-bottom-surface').props.style),
    ).toMatchObject({ height: 56 });
    expect(
      StyleSheet.flatten(screen.getByTestId('timeline-gutter-track-1').props.style),
    ).toMatchObject({ width: 36, height: 56 });
    expect(StyleSheet.flatten(screen.getByTestId('timeline-clip-layer').props.style)).toMatchObject(
      {
        top: 80,
        height: 112,
        left: 36,
        right: 36,
      },
    );
    expect(StyleSheet.flatten(screen.getByTestId('timeline-cursor').props.style)).toMatchObject({
      top: 0,
      bottom: 0,
      left: '50%',
    });
    expect(screen.queryByText('Timeline')).toBeNull();
    expect(screen.queryByText('Drag to pan / Pinch to zoom')).toBeNull();
    expect(() => getByGestureTestId('timeline-stage-pinch')).toThrow();
  });

  it('scrubs only from the upper/lower canvases and pauses at gesture begin', async () => {
    const props = timelineProps();
    const screen = await render(<ProjectTimeline {...props} />);
    await fireEvent(screen.getByTestId('timeline-gesture-stage'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 248 } },
    });

    expect(getByGestureTestId('timeline-ruler-scrub')).toBeTruthy();
    await fireEvent(
      screen.getByRole('adjustable', { name: 'Timeline ruler' }),
      'accessibilityAction',
      { nativeEvent: { actionName: 'increment' } },
    );

    expect(props.onScrubStart).toHaveBeenCalledTimes(1);
    expect(props.onScrubChange).toHaveBeenCalledWith(6_000);
    expect(props.onScrubEnd).toHaveBeenCalledWith(6_000);
    expect(props.onMoveClip).not.toHaveBeenCalled();
  });

  it('uses clip drags only for snapped placement and track changes', async () => {
    const props = timelineProps();
    const screen = await render(<ProjectTimeline {...props} />);
    await fireEvent(screen.getByTestId('timeline-gesture-stage'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 248 } },
    });

    await act(async () => {
      fireGestureHandler(getByGestureTestId(`timeline-clip-${clipA.id}-move`), [
        { state: State.BEGAN, numberOfPointers: 1, translationX: 0, translationY: 0 },
        { numberOfPointers: 1, translationX: 32, translationY: 40 },
        { state: State.END, numberOfPointers: 1, translationX: 32, translationY: 40 },
      ]);
    });

    expect(props.onEditStart).toHaveBeenCalledTimes(1);
    expect(props.onMoveClip).toHaveBeenCalledWith(clipA.id, 'track-2', expect.any(Number));
    expect(props.onScrubChange).not.toHaveBeenCalled();
  });
});

describe('overview and inline clip controls', () => {
  it('makes the overview the only visible-window control', async () => {
    const onChange = jest.fn();
    const onChangeEnd = jest.fn();
    const onInteractionStart = jest.fn();
    const screen = await render(
      <TimelineOverview
        clips={[clipA, clipB]}
        cursorMs={7_500}
        durationMs={15_000}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
        onInteractionStart={onInteractionStart}
        visibleSpanMs={5_000}
      />,
    );
    await fireEvent(screen.getByTestId('timeline-overview-track'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 40 } },
    });

    expect(screen.getByTestId('timeline-overview-left-handle')).toBeTruthy();
    expect(screen.getByTestId('timeline-overview-right-handle')).toBeTruthy();
    expect(OVERVIEW_HANDLE_HIT_WIDTH).toBeGreaterThanOrEqual(48);
    expect(
      StyleSheet.flatten(screen.getByTestId('timeline-overview-track').props.style),
    ).toMatchObject({ height: 48 });
    expect(
      screen
        .getByRole('adjustable', { name: 'Visible timeline range' })
        .props.accessibilityActions.map(({ name }: { name: string }) => name),
    ).toEqual(
      expect.arrayContaining([
        'resizeStartEarlier',
        'resizeStartLater',
        'resizeEndEarlier',
        'resizeEndLater',
      ]),
    );
    expect(getByGestureTestId('timeline-overview-drag')).toBeTruthy();
    await fireEvent(
      screen.getByRole('adjustable', { name: 'Visible timeline range' }),
      'accessibilityAction',
      { nativeEvent: { actionName: 'increment' } },
    );
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(8_000, 5_000);
    expect(onChangeEnd).toHaveBeenCalledWith(8_000, 5_000);

    await fireEvent(
      screen.getByRole('adjustable', { name: 'Visible timeline range' }),
      'accessibilityAction',
      { nativeEvent: { actionName: 'resizeStartLater' } },
    );
    expect(onChange).toHaveBeenLastCalledWith(7_750, 4_500);
    expect(onChangeEnd).toHaveBeenLastCalledWith(7_750, 4_500);
  });

  it('publishes overview drag updates locally and one final change on release', async () => {
    const onChange = jest.fn();
    const onChangeEnd = jest.fn();
    const screen = await render(
      <TimelineOverview
        clips={[clipA, clipB]}
        cursorMs={7_500}
        durationMs={15_000}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
        onInteractionStart={jest.fn()}
        visibleSpanMs={5_000}
      />,
    );
    await fireEvent(screen.getByTestId('timeline-overview-track'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 40 } },
    });

    await act(async () => {
      fireGestureHandler(getByGestureTestId('timeline-overview-drag'), [
        { state: State.BEGAN, numberOfPointers: 1, x: 150, translationX: 0 },
        { numberOfPointers: 1, x: 170, translationX: 20 },
        { numberOfPointers: 1, x: 190, translationX: 40 },
        { state: State.END, numberOfPointers: 1, x: 190, translationX: 40 },
      ]);
    });

    expect(onChange).toHaveBeenCalled();
    expect(onChangeEnd).toHaveBeenCalledTimes(1);
    expect(onChangeEnd).toHaveBeenLastCalledWith(9_500, 5_000);
  });

  it('commits volume once when a drag is released and exposes 5% accessibility steps', async () => {
    const onCommitVolume = jest.fn().mockResolvedValue(true);
    const screen = await render(
      <ClipInlineAdjustment
        clip={clipA}
        mode="volume"
        onCommitFades={jest.fn().mockResolvedValue(true)}
        onCommitVolume={onCommitVolume}
        onInteractionStart={jest.fn()}
      />,
    );
    const slider = screen.getByRole('adjustable', { name: 'Clip volume' });
    expect(StyleSheet.flatten(slider.props.style)).toMatchObject({ height: 48 });
    await fireEvent(slider, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 40 } },
    });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('clip-volume-slider-drag'), [
        { state: State.BEGAN, numberOfPointers: 1, x: 50 },
        { numberOfPointers: 1, x: 60 },
        { numberOfPointers: 1, x: 70 },
        { state: State.END, numberOfPointers: 1, x: 70 },
      ]);
    });
    await waitFor(() => expect(onCommitVolume).toHaveBeenCalledTimes(1));
    expect(onCommitVolume).toHaveBeenLastCalledWith(0.7);

    await fireEvent(slider, 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    await waitFor(() => expect(onCommitVolume).toHaveBeenLastCalledWith(0.65));
  });

  it.each([
    ['cancelled', State.CANCELLED],
    ['failed', State.FAILED],
  ])('restores the committed slider draft when a pan is %s', async (_label, finalState) => {
    const onCommitVolume = jest.fn().mockResolvedValue(true);
    const screen = await render(
      <ClipInlineAdjustment
        clip={clipA}
        mode="volume"
        onCommitFades={jest.fn().mockResolvedValue(true)}
        onCommitVolume={onCommitVolume}
        onInteractionStart={jest.fn()}
      />,
    );
    await fireEvent(screen.getByRole('adjustable', { name: 'Clip volume' }), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 48 } },
    });

    await act(async () => {
      fireGestureHandler(getByGestureTestId('clip-volume-slider-drag'), [
        { state: State.BEGAN, numberOfPointers: 1, x: 50 },
        { numberOfPointers: 1, x: 85 },
        { state: finalState, numberOfPointers: 1, x: 85 },
      ]);
    });

    expect(onCommitVolume).not.toHaveBeenCalled();
    expect(
      screen.getByRole('adjustable', { name: 'Clip volume' }).props.accessibilityValue,
    ).toMatchObject({ now: 50 });
  });

  it('rolls an inline adjustment back and locks it while persistence is pending', async () => {
    let resolveCommit: ((value: boolean) => void) | undefined;
    const onCommitVolume = jest.fn(
      () => new Promise<boolean>((resolve) => (resolveCommit = resolve)),
    );
    const screen = await render(
      <ClipInlineAdjustment
        clip={clipA}
        mode="volume"
        onCommitFades={jest.fn().mockResolvedValue(true)}
        onCommitVolume={onCommitVolume}
        onInteractionStart={jest.fn()}
      />,
    );
    const volume = screen.getByRole('adjustable', { name: 'Clip volume' });
    await fireEvent(volume, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    await fireEvent(volume, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });

    expect(onCommitVolume).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('adjustable', { name: 'Clip volume' }).props.accessibilityState,
    ).toMatchObject({ busy: true, disabled: true });
    await act(async () => resolveCommit?.(false));
    await waitFor(() =>
      expect(
        screen.getByRole('adjustable', { name: 'Clip volume' }).props.accessibilityValue,
      ).toMatchObject({ now: 50 }),
    );
  });

  it('uses two inline fade sliders with 500ms steps and no modal actions', async () => {
    const onCommitFades = jest.fn().mockResolvedValue(true);
    const screen = await render(
      <ClipInlineAdjustment
        clip={clipA}
        mode="fade"
        onCommitFades={onCommitFades}
        onCommitVolume={jest.fn().mockResolvedValue(true)}
        onInteractionStart={jest.fn()}
      />,
    );
    const fadeIn = screen.getByRole('adjustable', { name: 'Fade in duration' });
    expect(StyleSheet.flatten(screen.getByTestId('clip-inline-fade').props.style)).toMatchObject({
      height: 110,
    });
    expect(StyleSheet.flatten(fadeIn.props.style)).toMatchObject({ height: 48 });
    expect(fadeIn.props.accessibilityValue).toMatchObject({ min: 0, max: 6_000, now: 1_000 });
    await fireEvent(fadeIn, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    await waitFor(() => expect(onCommitFades).toHaveBeenCalledWith(1_500, 1_000));
    expect(screen.queryByText('Preview')).toBeNull();
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByText('Choose fixed fade lengths that fit inside the clip.')).toBeNull();
  });

  it('renders four icon-and-single-label clip actions', async () => {
    const screen = await render(
      <ClipActionRail
        onDelete={jest.fn()}
        onFade={jest.fn()}
        onSplit={jest.fn()}
        onVolume={jest.fn()}
        splitEnabled
        visible
      />,
    );
    expect(screen.getAllByText('Volume')).toHaveLength(1);
    expect(screen.getAllByText('Fade')).toHaveLength(1);
    expect(screen.getAllByText('Split')).toHaveLength(1);
    expect(screen.getAllByText('Delete')).toHaveLength(1);
    expect(screen.queryByText('VOL')).toBeNull();
    expect(screen.queryByText('FADE')).toBeNull();
    expect(screen.queryByText('SPLIT')).toBeNull();
    expect(screen.queryByText('DEL')).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('clip-action-rail').props.style)).toMatchObject({
      height: 58,
    });
  });

  it('isolates live Split eligibility and uses the editor cursor while paused', async () => {
    await act(async () => {
      usePlaybackStore.getState().reset();
      usePlaybackStore.getState().beginSession({
        projectId: 'project-live-split',
        playbackSessionId: 'session-live-split',
        generation: 1,
        controlRevision: 1,
        mode: 'composition',
        desiredPlaying: true,
      });
      usePlaybackStore.getState().applyStatus(
        {
          jobId: 'session-live-split',
          operation: 'preview',
          sequence: 1,
          stage: 'playing',
          generation: 1,
          playbackSessionId: 'session-live-split',
          controlRevision: 1,
          mode: 'composition',
          loaded: true,
          playing: true,
          positionMs: 5_000,
          durationMs: 15_000,
          currentClipIndex: 0,
          currentClipId: clipA.id,
          didJustFinish: false,
        },
        true,
      );
    });
    const screen = await render(
      <LiveClipActionRail
        fallbackCursorMs={15_000}
        onDelete={jest.fn()}
        onFade={jest.fn()}
        onSplit={jest.fn()}
        onVolume={jest.fn()}
        projectId="project-live-split"
        selectedClip={clipA}
      />,
    );

    expect(screen.getByRole('button', { name: 'Split' })).not.toBeDisabled();
    await act(async () => usePlaybackStore.getState().requestPause(2));
    expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled();

    await screen.rerender(
      <LiveClipActionRail
        fallbackCursorMs={5_000}
        onDelete={jest.fn()}
        onFade={jest.fn()}
        onSplit={jest.fn()}
        onVolume={jest.fn()}
        projectId="project-live-split"
        selectedClip={clipA}
      />,
    );
    expect(screen.getByRole('button', { name: 'Split' })).not.toBeDisabled();
    await act(async () => usePlaybackStore.getState().reset());
  });

  it('accepts only the latest matching composition Pause acknowledgement', () => {
    const playback = {
      projectId: 'project-ack',
      mode: 'composition' as const,
      desiredPlaying: false,
      pausePending: false,
      controlRevision: 7,
      positionMs: 3_210,
    };
    expect(acknowledgedCompositionPausePosition(4, 4, 7, 'project-ack', playback)).toBe(3_210);
    expect(acknowledgedCompositionPausePosition(4, 5, 7, 'project-ack', playback)).toBeNull();
    expect(
      acknowledgedCompositionPausePosition(4, 4, 7, 'project-ack', {
        ...playback,
        desiredPlaying: true,
      }),
    ).toBeNull();
    expect(
      acknowledgedCompositionPausePosition(4, 4, 7, 'project-ack', {
        ...playback,
        pausePending: true,
      }),
    ).toBeNull();
    expect(acknowledgedCompositionPausePosition(4, 4, 8, 'project-ack', playback)).toBeNull();
    expect(acknowledgedCompositionPausePosition(4, 4, 7, 'another-project', playback)).toBeNull();
  });
});

describe('secondary Media library', () => {
  it('keeps Media limited to preview and add-full actions', async () => {
    const onAddFull = jest.fn();
    const onClose = jest.fn();
    const screen = await render(
      <MediaLibraryModal
        importBusy={false}
        onAddFull={onAddFull}
        onClose={onClose}
        onImport={jest.fn()}
        onPreview={jest.fn()}
        previewLoading={false}
        previewPlaying={false}
        previewSourceId={null}
        sources={[source]}
        visible
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: `Add ${source.displayName} to Track 1` }),
    );
    expect(onAddFull).toHaveBeenCalledWith(source);
    expect(screen.queryByText('Details')).toBeNull();
    expect(screen.queryByText('Trim & Place')).toBeNull();
    await fireEvent.press(screen.getByTestId('media-library-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('project editor workspace structure', () => {
  it('orders transport, fixed timeline, overview, actions, and inline controls', () => {
    const editorSource = readFileSync(resolve(__dirname, '../app/project/[id].tsx'), 'utf8');
    const transportIndex = editorSource.indexOf('<LivePlaybackControls');
    const timelineIndex = editorSource.indexOf('<LiveProjectTimeline');
    const overviewIndex = editorSource.indexOf('<LiveTimelineOverview');
    const actionRailIndex = editorSource.indexOf('<LiveClipActionRail');
    const inlineIndex = editorSource.indexOf('<ClipInlineAdjustment');

    expect(transportIndex).toBeGreaterThan(-1);
    expect(timelineIndex).toBeGreaterThan(transportIndex);
    expect(overviewIndex).toBeGreaterThan(timelineIndex);
    expect(actionRailIndex).toBeGreaterThan(overviewIndex);
    expect(inlineIndex).toBeGreaterThan(actionRailIndex);
    expect(editorSource).not.toContain('<ScrollView');
    expect(editorSource).not.toContain('showActions');
    expect(editorSource).not.toContain('ConfirmDeleteModal');
    expect(editorSource).not.toContain('ClipVolumeModal');
    expect(editorSource).not.toContain('ClipFadeModal');
    expect(editorSource).not.toContain('Tap a clip to select');
    expect(editorSource).not.toContain('toggleComposition');
    expect(editorSource).toContain('pauseComposition()');
    expect(editorSource).toContain('seek(positionMs, false)');
    expect(editorSource).toContain('seek(cursorMs, false)');
    expect(editorSource).toContain('onChangeEnd={finishOverviewChange}');
    expect(editorSource).toContain('(playback.desiredPlaying || playback.playing)');
    expect(editorSource).toContain(': useEditorStore.getState().timelineCursorMs');
    expect(editorSource).toContain('active && (state.desiredPlaying || state.playing)');
    expect(editorSource).toContain("edges={['top', 'bottom', 'left', 'right']}");
    expect(editorSource).toContain('testID="editor-error-overlay"');
    expect(editorSource).toContain('acknowledgedCompositionPausePosition(');
    expect(editorSource).toContain('requestedInteractionRevision');
    expect(
      editorSource.match(/timelineInteractionRevision\.current \+= 1/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    const errorOverlayStyle = editorSource.slice(
      editorSource.indexOf('errorOverlay: {'),
      editorSource.indexOf('errorOverlay: {') + 220,
    );
    expect(errorOverlayStyle).toContain("position: 'absolute'");
    expect(errorOverlayStyle).toContain('zIndex: 40');
  });

  it('does not mirror the 50ms playback position into editor state', () => {
    const editorSource = readFileSync(resolve(__dirname, '../app/project/[id].tsx'), 'utf8');
    expect(editorSource).not.toContain(
      'setTimelineCursorMs(playbackPositionMs, compositionDurationMs(project.clips))',
    );
    expect(editorSource).not.toContain('const playbackPositionMs = usePlaybackStore');
  });
});
