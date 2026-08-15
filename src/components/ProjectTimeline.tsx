/* eslint-disable react-hooks/refs -- active RNGH drags read refs so timeline updates cannot replace a gesture mid-flight. */
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, formatDuration, radii, typography } from '@/constants';
import { snapClipTimelineStartMs } from '@/domain';
import type { SnapCutClip, SnapCutSource, WaveformFileV1 } from '@/domain';
import {
  buildWaveformFillPath,
  getCenteredTimelineViewport,
  projectTimelineDurationMs,
  sampleTimelineClipWaveform,
  timelineClipGeometry,
  timelineFadeGeometry,
  timelineTrimDraft,
  timelineXToTime,
  type TimelineTrimEdge,
} from '@/utils';

import { editorWorkspaceLayout } from './editorWorkspaceLayout';

export type EditorTrackId = 'track-1' | 'track-2';

export interface ProjectTimelineProps {
  clips: readonly SnapCutClip[];
  sources: readonly SnapCutSource[];
  selectedTrackId: EditorTrackId;
  selectedClipId: string | null;
  waveformsBySourceId: Readonly<Record<string, WaveformFileV1 | null | undefined>>;
  cursorMs: number;
  visibleSpanMs: number;
  onMoveClip: (
    clipId: string,
    trackId: EditorTrackId,
    timelineStartMs: number,
  ) => void | Promise<unknown>;
  onTrimClipEdge?: (
    clipId: string,
    edge: TimelineTrimEdge,
    requestedSourceMs: number,
  ) => void | Promise<unknown>;
  onSelectClip: (clipId: string) => void;
  onSelectTrack: (trackId: EditorTrackId) => void;
  onEditStart?: () => void;
  onScrubStart: () => void;
  onScrubChange: (positionMs: number) => void;
  onScrubEnd: (positionMs: number) => void;
}

const TRACK_HEIGHT = editorWorkspaceLayout.timelineTrackHeight;
const TRACKS_HEIGHT = TRACK_HEIGHT * 2;
const RULER_INTERACTION_HEIGHT = editorWorkspaceLayout.timelineRulerHeight;
const GESTURE_STAGE_HEIGHT = editorWorkspaceLayout.timelineStageHeight;
const TIMELINE_GUTTER_WIDTH = 36;
const TIMELINE_TRAILING_PADDING = TIMELINE_GUTTER_WIDTH;
const BOTTOM_INTERACTION_HEIGHT = editorWorkspaceLayout.timelineLowerScrubHeight;
const CLIP_VERTICAL_INSET = 3;
const CLIP_HEIGHT = TRACK_HEIGHT - CLIP_VERTICAL_INSET * 2;
const EDGE_HANDLE_HIT_SIZE = 32;
const EDGE_HANDLE_VISIBLE_WIDTH = 6;
const DRAG_SLOP = 3;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function trackLabel(trackId: EditorTrackId): string {
  return trackId === 'track-1' ? 'Track 1' : 'Track 2';
}

function trackTop(trackId: EditorTrackId): number {
  return trackId === 'track-1' ? 0 : TRACK_HEIGHT;
}

function movedClipDraft(
  clip: SnapCutClip,
  allClips: readonly SnapCutClip[],
  deltaX: number,
  deltaY: number,
  timelineWidth: number,
  viewportDurationMs: number,
): SnapCutClip {
  const deltaMs =
    timelineWidth <= 0 ? 0 : Math.round((deltaX / timelineWidth) * viewportDurationMs);
  let targetTrack = clip.trackId;
  if (clip.trackId === 'track-1' && deltaY >= TRACK_HEIGHT / 2) targetTrack = 'track-2';
  if (clip.trackId === 'track-2' && deltaY <= -TRACK_HEIGHT / 2) targetTrack = 'track-1';
  const requestedStartMs = Math.max(0, clip.timelineStartMs + deltaMs);
  return {
    ...clip,
    trackId: targetTrack,
    timelineStartMs: snapClipTimelineStartMs(
      allClips,
      { ...clip, trackId: targetTrack, timelineStartMs: requestedStartMs },
      requestedStartMs,
      targetTrack,
      clip.id,
    ),
  };
}

interface TimelineClipProps {
  clip: SnapCutClip;
  committedClip: SnapCutClip;
  allClips: readonly SnapCutClip[];
  source: SnapCutSource;
  waveform: WaveformFileV1 | null | undefined;
  left: number;
  width: number;
  visibleStartMs: number;
  visibleEndMs: number;
  selected: boolean;
  leftEdgeVisible: boolean;
  rightEdgeVisible: boolean;
  trimEdge: TimelineTrimEdge | null;
  stageWidth: number;
  viewportDurationMs: number;
  onMoveDraft: (clip: SnapCutClip) => void;
  onMoveCommit: (clip: SnapCutClip) => void;
  onTrimDraft: (edge: TimelineTrimEdge, clip: SnapCutClip) => void;
  onTrimCommit: (edge: TimelineTrimEdge, requestedSourceMs: number, clip: SnapCutClip) => void;
  onCancelDraft: () => void;
  onInteractionStart: () => void;
  onSelect: () => void;
}

function TimelineClip({
  clip,
  committedClip,
  allClips,
  source,
  waveform,
  left,
  width,
  visibleStartMs,
  visibleEndMs,
  selected,
  leftEdgeVisible,
  rightEdgeVisible,
  trimEdge,
  stageWidth,
  viewportDurationMs,
  onMoveDraft,
  onMoveCommit,
  onTrimDraft,
  onTrimCommit,
  onCancelDraft,
  onInteractionStart,
  onSelect,
}: TimelineClipProps) {
  const interactionRef = useRef({
    onCancelDraft,
    onInteractionStart,
    onMoveCommit,
    onMoveDraft,
    onSelect,
    onTrimCommit,
    onTrimDraft,
  });
  interactionRef.current = {
    onCancelDraft,
    onInteractionStart,
    onMoveCommit,
    onMoveDraft,
    onSelect,
    onTrimCommit,
    onTrimDraft,
  };
  const amplitudes = useMemo(
    () =>
      sampleTimelineClipWaveform(
        clip,
        source,
        waveform,
        Math.max(16, Math.min(240, Math.round(width))),
        visibleStartMs,
        visibleEndMs,
      ),
    [clip, source, waveform, width, visibleStartMs, visibleEndMs],
  );
  const waveformHeight = CLIP_HEIGHT - 14;
  const path = useMemo(
    () =>
      buildWaveformFillPath(
        amplitudes,
        Math.max(1, width),
        waveformHeight,
        0,
        amplitudes.length,
        240,
      ),
    [amplitudes, waveformHeight, width],
  );
  const fades = useMemo(
    () => timelineFadeGeometry(clip, visibleStartMs, visibleEndMs, width),
    [clip, visibleEndMs, visibleStartMs, width],
  );
  const trimDraftForTranslation = (edge: TimelineTrimEdge, translationX: number) => {
    const deltaMs =
      stageWidth <= 0 ? 0 : Math.round((translationX / stageWidth) * viewportDurationMs);
    const edgePositionMs =
      edge === 'left'
        ? committedClip.timelineStartMs + deltaMs
        : committedClip.timelineStartMs + (committedClip.endMs - committedClip.startMs) + deltaMs;
    return timelineTrimDraft(committedClip, source.durationMs, edge, edgePositionMs, 100, allClips);
  };
  const makeTrimGesture = (edge: TimelineTrimEdge) =>
    Gesture.Pan()
      .maxPointers(1)
      .minDistance(1)
      .withTestId(`timeline-clip-${clip.id}-trim-${edge}`)
      .onBegin(() => {
        interactionRef.current.onInteractionStart();
        interactionRef.current.onSelect();
      })
      .onUpdate((event) =>
        interactionRef.current.onTrimDraft(edge, trimDraftForTranslation(edge, event.translationX)),
      )
      .onEnd((event) => {
        const draft = trimDraftForTranslation(edge, event.translationX);
        interactionRef.current.onTrimCommit(
          edge,
          edge === 'left' ? draft.startMs : draft.endMs,
          draft,
        );
      })
      .onFinalize((_event, success) => {
        if (!success) interactionRef.current.onCancelDraft();
      })
      .runOnJS(true);
  const leftTrimGesture = useMemo(
    () => makeTrimGesture('left'),
    // One gesture intentionally snapshots all drag inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allClips, committedClip, source.durationMs, stageWidth, viewportDurationMs],
  );
  const rightTrimGesture = useMemo(
    () => makeTrimGesture('right'),
    // One gesture intentionally snapshots all drag inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allClips, committedClip, source.durationMs, stageWidth, viewportDurationMs],
  );
  const bodyGesture = useMemo(() => {
    const move = Gesture.Pan()
      .maxPointers(1)
      .minDistance(DRAG_SLOP)
      .withTestId(`timeline-clip-${clip.id}-move`)
      .onBegin(() => {
        interactionRef.current.onInteractionStart();
        interactionRef.current.onSelect();
      })
      .onUpdate((event) =>
        interactionRef.current.onMoveDraft(
          movedClipDraft(
            committedClip,
            allClips,
            event.translationX,
            event.translationY,
            stageWidth,
            viewportDurationMs,
          ),
        ),
      )
      .onEnd((event) =>
        interactionRef.current.onMoveCommit(
          movedClipDraft(
            committedClip,
            allClips,
            event.translationX,
            event.translationY,
            stageWidth,
            viewportDurationMs,
          ),
        ),
      )
      .onFinalize((_event, success) => {
        if (!success) interactionRef.current.onCancelDraft();
      })
      .runOnJS(true);
    const select = Gesture.Tap()
      .maxDistance(DRAG_SLOP)
      .onEnd((_event, success) => {
        if (success) interactionRef.current.onSelect();
      })
      .runOnJS(true);
    if (leftEdgeVisible && rightEdgeVisible) {
      move.requireExternalGestureToFail(leftTrimGesture, rightTrimGesture);
      select.requireExternalGestureToFail(leftTrimGesture, rightTrimGesture);
    } else if (leftEdgeVisible) {
      move.requireExternalGestureToFail(leftTrimGesture);
      select.requireExternalGestureToFail(leftTrimGesture);
    } else if (rightEdgeVisible) {
      move.requireExternalGestureToFail(rightTrimGesture);
      select.requireExternalGestureToFail(rightTrimGesture);
    }
    return Gesture.Exclusive(move, select);
  }, [
    allClips,
    clip.id,
    committedClip,
    leftEdgeVisible,
    leftTrimGesture,
    rightEdgeVisible,
    rightTrimGesture,
    stageWidth,
    viewportDurationMs,
  ]);
  const adjustTrimAccessibly = (edge: TimelineTrimEdge, direction: -1 | 1) => {
    onInteractionStart();
    onSelect();
    const currentEdgeMs =
      edge === 'left'
        ? committedClip.timelineStartMs
        : committedClip.timelineStartMs + committedClip.endMs - committedClip.startMs;
    const draft = timelineTrimDraft(
      committedClip,
      source.durationMs,
      edge,
      currentEdgeMs + direction * 100,
      100,
      allClips,
    );
    onTrimCommit(edge, edge === 'left' ? draft.startMs : draft.endMs, draft);
  };
  const fadeLabel = [
    clip.fadeInMs > 0 ? `in ${clip.fadeInMs / 1000}s` : null,
    clip.fadeOutMs > 0 ? `out ${clip.fadeOutMs / 1000}s` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const clipTop = trackTop(clip.trackId) + CLIP_VERTICAL_INSET;
  const leftEdgeX = left;
  const rightEdgeX = left + width;
  const targetLeftForEdge = (edgeX: number) =>
    clamp(edgeX - EDGE_HANDLE_HIT_SIZE / 2, 0, Math.max(0, stageWidth - EDGE_HANDLE_HIT_SIZE));
  const leftHandleLeft = targetLeftForEdge(leftEdgeX);
  const rightHandleLeft = targetLeftForEdge(rightEdgeX);
  const handlesOverlap =
    leftHandleLeft < rightHandleLeft + EDGE_HANDLE_HIT_SIZE &&
    rightHandleLeft < leftHandleLeft + EDGE_HANDLE_HIT_SIZE;
  const handleTop = trackTop(clip.trackId) + (handlesOverlap ? 0 : 12);
  const rightHandleTop = trackTop(clip.trackId) + (handlesOverlap ? EDGE_HANDLE_HIT_SIZE : 12);
  const visibleBarLeft = (edgeX: number) =>
    clamp(
      edgeX - EDGE_HANDLE_VISIBLE_WIDTH / 2,
      0,
      Math.max(0, stageWidth - EDGE_HANDLE_VISIBLE_WIDTH),
    );
  const tooltipLeft = clamp(
    trimEdge === 'right' ? rightEdgeX - 104 - EDGE_HANDLE_VISIBLE_WIDTH : leftEdgeX + 8,
    0,
    Math.max(0, stageWidth - 104),
  );

  return (
    <>
      <GestureDetector gesture={bodyGesture}>
        <View
          accessible={!selected}
          accessibilityHint="Tap to edit. Drag horizontally to move in time or vertically to change track."
          accessibilityLabel={`${source.displayName}, ${formatDuration(clip.endMs - clip.startMs)}, gain ${Math.round(clip.gain * 100)} percent${fadeLabel ? `, fade ${fadeLabel}` : ''}`}
          accessibilityRole={selected ? undefined : 'button'}
          accessibilityState={{ selected }}
          onAccessibilityTap={selected ? undefined : onSelect}
          style={[styles.clip, { left, width, top: clipTop }, selected && styles.selectedClip]}
          testID={`timeline-clip-${clip.id}`}
        >
          <Svg height={waveformHeight} pointerEvents="none" width="100%">
            <Rect
              fill={selected ? colors.accentTranslucent : colors.soft}
              height="100%"
              width="100%"
            />
            <Path
              d={path}
              fill={selected ? colors.focus : colors.textSecondary}
              opacity={0.9}
              testID={`timeline-clip-waveform-${clip.id}`}
            />
            {fades.fadeIn ? (
              <>
                <Rect
                  fill={colors.accentTranslucent}
                  height="100%"
                  testID={`timeline-clip-fade-in-mask-${clip.id}`}
                  width={fades.fadeIn.width}
                  x={fades.fadeIn.left}
                />
                <Path
                  d={`M ${fades.fadeIn.left} ${waveformHeight - 5} L ${fades.fadeIn.left + fades.fadeIn.width} 5`}
                  fill="none"
                  opacity={0.8}
                  stroke={colors.focus}
                  strokeWidth={1.5}
                />
              </>
            ) : null}
            {fades.fadeOut ? (
              <>
                <Rect
                  fill={colors.accentTranslucent}
                  height="100%"
                  testID={`timeline-clip-fade-out-mask-${clip.id}`}
                  width={fades.fadeOut.width}
                  x={fades.fadeOut.left}
                />
                <Path
                  d={`M ${fades.fadeOut.left} 5 L ${fades.fadeOut.left + fades.fadeOut.width} ${waveformHeight - 5}`}
                  fill="none"
                  opacity={0.8}
                  stroke={colors.focus}
                  strokeWidth={1.5}
                />
              </>
            ) : null}
          </Svg>
          <Text numberOfLines={1} style={styles.clipLabel}>
            {source.displayName}
          </Text>
        </View>
      </GestureDetector>
      {selected && (leftEdgeVisible || trimEdge === 'left') ? (
        <GestureDetector gesture={leftTrimGesture}>
          <View
            accessible
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            accessibilityHint="Drag to change the clip start."
            accessibilityLabel={`Trim start of ${source.displayName}`}
            accessibilityRole="adjustable"
            accessibilityValue={{ text: `${clip.startMs} milliseconds` }}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') adjustTrimAccessibly('left', 1);
              if (event.nativeEvent.actionName === 'decrement') adjustTrimAccessibly('left', -1);
            }}
            style={[styles.edgeHandleHit, { left: leftHandleLeft, top: handleTop }]}
            testID={`timeline-clip-left-handle-${clip.id}`}
          />
        </GestureDetector>
      ) : null}
      {selected && (rightEdgeVisible || trimEdge === 'right') ? (
        <GestureDetector gesture={rightTrimGesture}>
          <View
            accessible
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            accessibilityHint="Drag to change the clip end."
            accessibilityLabel={`Trim end of ${source.displayName}`}
            accessibilityRole="adjustable"
            accessibilityValue={{ text: `${clip.endMs} milliseconds` }}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') adjustTrimAccessibly('right', 1);
              if (event.nativeEvent.actionName === 'decrement') adjustTrimAccessibly('right', -1);
            }}
            style={[styles.edgeHandleHit, { left: rightHandleLeft, top: rightHandleTop }]}
            testID={`timeline-clip-right-handle-${clip.id}`}
          />
        </GestureDetector>
      ) : null}
      {selected && leftEdgeVisible ? (
        <View
          pointerEvents="none"
          style={[styles.edgeHandleVisible, { left: visibleBarLeft(leftEdgeX), top: clipTop + 8 }]}
          testID="timeline-left-handle-visible"
        />
      ) : null}
      {selected && rightEdgeVisible ? (
        <View
          pointerEvents="none"
          style={[styles.edgeHandleVisible, { left: visibleBarLeft(rightEdgeX), top: clipTop + 8 }]}
          testID="timeline-right-handle-visible"
        />
      ) : null}
      {selected && trimEdge ? (
        <View
          pointerEvents="none"
          style={[styles.trimTooltip, { left: tooltipLeft, top: clipTop + 2 }]}
          testID="timeline-trim-tooltip"
        >
          <Text style={styles.trimTooltipText}>
            {trimEdge === 'left' ? 'Start' : 'End'}{' '}
            {trimEdge === 'left' ? clip.startMs : clip.endMs} ms
          </Text>
        </View>
      ) : null}
    </>
  );
}

export function ProjectTimeline({
  clips,
  sources,
  selectedTrackId,
  selectedClipId,
  waveformsBySourceId,
  cursorMs,
  visibleSpanMs,
  onMoveClip,
  onTrimClipEdge,
  onSelectClip,
  onSelectTrack,
  onEditStart = () => undefined,
  onScrubStart,
  onScrubChange,
  onScrubEnd,
}: ProjectTimelineProps) {
  const [stageWidth, setStageWidth] = useState(0);
  const [gestureDraft, setGestureDraftState] = useState<{
    clip: SnapCutClip;
    kind: 'move' | 'trim';
    edge?: TimelineTrimEdge;
  } | null>(null);
  const gestureDraftRef = useRef(gestureDraft);
  const timelineWidth = Math.max(0, stageWidth - TIMELINE_GUTTER_WIDTH - TIMELINE_TRAILING_PADDING);
  const projectDurationMs = projectTimelineDurationMs(clips);
  const viewport = getCenteredTimelineViewport(projectDurationMs, visibleSpanMs, cursorMs);
  const scrubContractRef = useRef({
    cursorMs,
    onScrubChange,
    onScrubEnd,
    onScrubStart,
    projectDurationMs,
    timelineWidth,
    viewport,
  });
  scrubContractRef.current = {
    cursorMs,
    onScrubChange,
    onScrubEnd,
    onScrubStart,
    projectDurationMs,
    timelineWidth,
    viewport,
  };
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  const rulerTicks = Array.from({ length: 5 }, (_, index) => {
    const timeMs = viewport.startMs + (viewport.durationMs * index) / 4;
    return { timeMs, left: `${index * 25}%` as const };
  }).filter(({ timeMs }) => timeMs >= 0 && timeMs <= projectDurationMs);
  const setGestureDraft = (
    draft: { clip: SnapCutClip; kind: 'move' | 'trim'; edge?: TimelineTrimEdge } | null,
  ) => {
    gestureDraftRef.current = draft;
    setGestureDraftState(draft);
  };
  const settleGestureDraft = (
    draft: { clip: SnapCutClip; kind: 'move' | 'trim'; edge?: TimelineTrimEdge },
    commit: () => void | Promise<unknown>,
  ) => {
    setGestureDraft(draft);
    void Promise.resolve(commit()).finally(() => {
      if (gestureDraftRef.current?.clip === draft.clip) setGestureDraft(null);
    });
  };
  const makeScrubGesture = (testID: string) => {
    let startCursorMs = 0;
    let dragTimelineWidth = 1;
    let dragViewportDurationMs = 1;
    let dragProjectDurationMs = 0;
    const positionForTranslation = (translationX: number) =>
      clamp(
        Math.round(
          startCursorMs - (translationX / Math.max(1, dragTimelineWidth)) * dragViewportDurationMs,
        ),
        0,
        dragProjectDurationMs,
      );
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(DRAG_SLOP)
      .withTestId(testID)
      .onBegin(() => {
        const latest = scrubContractRef.current;
        startCursorMs = latest.cursorMs;
        dragTimelineWidth = latest.timelineWidth;
        dragViewportDurationMs = latest.viewport.durationMs;
        dragProjectDurationMs = latest.projectDurationMs;
        latest.onScrubStart();
      })
      .onUpdate((event) =>
        scrubContractRef.current.onScrubChange(positionForTranslation(event.translationX)),
      )
      .onEnd((event) =>
        scrubContractRef.current.onScrubEnd(positionForTranslation(event.translationX)),
      )
      .runOnJS(true);
    const tap = Gesture.Tap()
      .maxDistance(DRAG_SLOP)
      .onEnd((event, success) => {
        if (!success) return;
        const latest = scrubContractRef.current;
        const positionMs = clamp(
          timelineXToTime(event.x - TIMELINE_GUTTER_WIDTH, latest.timelineWidth, latest.viewport),
          0,
          latest.projectDurationMs,
        );
        latest.onScrubStart();
        latest.onScrubChange(positionMs);
        latest.onScrubEnd(positionMs);
      })
      .runOnJS(true);
    return Gesture.Exclusive(pan, tap);
  };
  const rulerGesture = useMemo(
    () => makeScrubGesture('timeline-ruler-scrub'),
    // The gesture snapshots the latest ref at begin and stays mounted while scrubbing.
    [],
  );
  const bottomGesture = useMemo(
    () => makeScrubGesture('timeline-bottom-scrub'),
    // The gesture snapshots the latest ref at begin and stays mounted while scrubbing.
    [],
  );
  const makeTrackGesture = (trackId: EditorTrackId) =>
    Gesture.Tap()
      .maxDistance(DRAG_SLOP)
      .onEnd((_event, success) => {
        if (success) onSelectTrack(trackId);
      })
      .runOnJS(true);
  const trackOneGesture = useMemo(
    () => makeTrackGesture('track-1'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectTrack],
  );
  const trackTwoGesture = useMemo(
    () => makeTrackGesture('track-2'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectTrack],
  );

  return (
    <View style={styles.container} testID="project-timeline">
      <View
        onLayout={(event) => setStageWidth(event.nativeEvent.layout.width)}
        style={styles.gestureStage}
        testID="timeline-gesture-stage"
      >
        <GestureDetector gesture={rulerGesture}>
          <View
            accessible
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            accessibilityHint="Tap or drag horizontally to choose the playback time."
            accessibilityLabel="Timeline ruler"
            accessibilityRole="adjustable"
            accessibilityValue={{ min: 0, max: projectDurationMs, now: cursorMs }}
            onAccessibilityAction={(event) => {
              const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
              const positionMs = clamp(cursorMs + direction * 1_000, 0, projectDurationMs);
              onScrubStart();
              onScrubChange(positionMs);
              onScrubEnd(positionMs);
            }}
            style={styles.rulerSurface}
            testID="timeline-pan-surface"
          >
            <View pointerEvents="none" style={styles.rulerTimeline}>
              {rulerTicks.map((tick) => (
                <View key={tick.left} style={[styles.rulerTick, { left: tick.left }]}>
                  <View style={styles.tickLine} />
                  <Text style={styles.tickLabel}>{formatDuration(tick.timeMs)}</Text>
                </View>
              ))}
            </View>
          </View>
        </GestureDetector>

        <View style={styles.tracks}>
          <GestureDetector gesture={trackOneGesture}>
            <View
              accessible
              accessibilityHint="Tap to select Track 1. Drag a clip to move it."
              accessibilityLabel={trackLabel('track-1')}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedTrackId === 'track-1' }}
              style={[styles.track, selectedTrackId === 'track-1' && styles.selectedTrack]}
              testID="timeline-track-1"
            />
          </GestureDetector>
          <GestureDetector gesture={trackTwoGesture}>
            <View
              accessible
              accessibilityHint="Tap to select Track 2. Drag a clip to move it."
              accessibilityLabel={trackLabel('track-2')}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedTrackId === 'track-2' }}
              style={[styles.track, selectedTrackId === 'track-2' && styles.selectedTrack]}
              testID="timeline-track-2"
            />
          </GestureDetector>
        </View>

        <GestureDetector gesture={bottomGesture}>
          <View
            accessible
            accessibilityHint="Tap or drag horizontally to choose the playback time."
            accessibilityLabel="Timeline lower scrub area"
            accessibilityRole="adjustable"
            accessibilityValue={{ min: 0, max: projectDurationMs, now: cursorMs }}
            style={styles.bottomSurface}
            testID="timeline-bottom-surface"
          />
        </GestureDetector>

        <View pointerEvents="box-none" style={styles.clipLayer} testID="timeline-clip-layer">
          {clips.map((committedClip) => {
            const clip =
              gestureDraft?.clip.id === committedClip.id ? gestureDraft.clip : committedClip;
            const geometry = timelineClipGeometry(clip, viewport, timelineWidth);
            const source = sourceById.get(clip.sourceId);
            if (!geometry || !source) return null;
            const clipEndMs = clip.timelineStartMs + clip.endMs - clip.startMs;
            return (
              <TimelineClip
                allClips={clips}
                clip={clip}
                committedClip={committedClip}
                key={committedClip.id}
                left={geometry.left}
                leftEdgeVisible={geometry.visibleStartMs <= clip.timelineStartMs}
                onCancelDraft={() => setGestureDraft(null)}
                onInteractionStart={onEditStart}
                onMoveCommit={(draft) =>
                  settleGestureDraft({ clip: draft, kind: 'move' }, () =>
                    onMoveClip(draft.id, draft.trackId, draft.timelineStartMs),
                  )
                }
                onMoveDraft={(draft) => setGestureDraft({ clip: draft, kind: 'move' })}
                onSelect={() => onSelectClip(committedClip.id)}
                onTrimCommit={(edge, requestedSourceMs, draft) => {
                  if (!onTrimClipEdge) {
                    setGestureDraft(null);
                    return;
                  }
                  settleGestureDraft({ clip: draft, kind: 'trim', edge }, () =>
                    onTrimClipEdge(committedClip.id, edge, requestedSourceMs),
                  );
                }}
                onTrimDraft={(edge, draft) => setGestureDraft({ clip: draft, kind: 'trim', edge })}
                rightEdgeVisible={geometry.visibleEndMs >= clipEndMs}
                selected={selectedClipId === committedClip.id}
                source={source}
                stageWidth={timelineWidth}
                trimEdge={
                  gestureDraft?.clip.id === committedClip.id && gestureDraft.kind === 'trim'
                    ? (gestureDraft.edge ?? null)
                    : null
                }
                viewportDurationMs={viewport.durationMs}
                visibleEndMs={geometry.visibleEndMs}
                visibleStartMs={geometry.visibleStartMs}
                waveform={waveformsBySourceId[clip.sourceId]}
                width={geometry.width}
              />
            );
          })}
        </View>

        <View pointerEvents="none" style={styles.trackGutters}>
          <View style={styles.trackGutter} testID="timeline-gutter-track-1">
            <Text style={styles.trackLabel}>1</Text>
          </View>
          <View style={styles.trackGutter} testID="timeline-gutter-track-2">
            <Text style={styles.trackLabel}>2</Text>
          </View>
        </View>

        <View pointerEvents="none" style={styles.playhead} testID="timeline-cursor">
          <View style={styles.playheadCap} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 0,
  },
  gestureStage: {
    height: GESTURE_STAGE_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  rulerSurface: {
    height: RULER_INTERACTION_HEIGHT,
    position: 'relative',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.background,
  },
  rulerTimeline: {
    position: 'absolute',
    top: 0,
    right: TIMELINE_TRAILING_PADDING,
    bottom: 0,
    left: TIMELINE_GUTTER_WIDTH,
  },
  rulerTick: {
    position: 'absolute',
    top: 0,
    alignItems: 'flex-start',
  },
  tickLine: {
    width: 1,
    height: 7,
    backgroundColor: colors.border,
  },
  tickLabel: {
    ...typography.caption,
    fontSize: 11,
    transform: [{ translateX: -2 }],
  },
  tracks: {
    height: TRACKS_HEIGHT,
    position: 'relative',
  },
  track: {
    height: TRACK_HEIGHT,
    overflow: 'hidden',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface,
  },
  selectedTrack: {
    backgroundColor: colors.accentTranslucent,
  },
  trackGutters: {
    position: 'absolute',
    zIndex: 8,
    top: RULER_INTERACTION_HEIGHT,
    left: 0,
    width: TIMELINE_GUTTER_WIDTH,
    height: TRACKS_HEIGHT,
  },
  trackGutter: {
    width: TIMELINE_GUTTER_WIDTH,
    height: TRACK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.modalBackdrop,
  },
  trackLabel: {
    ...typography.caption,
    color: colors.focus,
    fontWeight: '700',
  },
  clipLayer: {
    position: 'absolute',
    zIndex: 2,
    top: RULER_INTERACTION_HEIGHT,
    right: TIMELINE_TRAILING_PADDING,
    height: TRACKS_HEIGHT,
    left: TIMELINE_GUTTER_WIDTH,
  },
  bottomSurface: {
    height: BOTTOM_INTERACTION_HEIGHT,
    position: 'relative',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.background,
  },
  clip: {
    position: 'absolute',
    zIndex: 2,
    height: CLIP_HEIGHT,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    backgroundColor: colors.soft,
  },
  selectedClip: {
    zIndex: 3,
    borderColor: colors.textPrimary,
    borderWidth: 2,
  },
  clipLabel: {
    ...typography.caption,
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 0,
    color: colors.textPrimary,
    fontSize: 10,
    lineHeight: 12,
  },
  edgeHandleHit: {
    position: 'absolute',
    zIndex: 5,
    width: EDGE_HANDLE_HIT_SIZE,
    height: EDGE_HANDLE_HIT_SIZE,
  },
  edgeHandleVisible: {
    position: 'absolute',
    zIndex: 6,
    width: EDGE_HANDLE_VISIBLE_WIDTH,
    height: 34,
    borderRadius: 3,
    backgroundColor: colors.textPrimary,
  },
  trimTooltip: {
    position: 'absolute',
    zIndex: 7,
    maxWidth: 104,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  trimTooltipText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontSize: 10,
    lineHeight: 13,
    fontVariant: ['tabular-nums'],
  },
  playhead: {
    position: 'absolute',
    zIndex: 12,
    top: 0,
    bottom: 0,
    left: '50%',
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.error,
  },
  playheadCap: {
    width: 10,
    height: 10,
    marginLeft: -4,
    borderRadius: 5,
    backgroundColor: colors.error,
  },
});
