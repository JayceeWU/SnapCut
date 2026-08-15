/* eslint-disable react-hooks/refs -- RNGH callbacks use refs to keep an in-progress overview drag stable across store updates. */
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { colors, formatDuration, radii } from '@/constants';
import type { SnapCutClip } from '@/domain';

import { editorWorkspaceLayout } from './editorWorkspaceLayout';

interface TimelineOverviewProps {
  clips: readonly SnapCutClip[];
  cursorMs: number;
  durationMs: number;
  visibleSpanMs: number;
  disabled?: boolean;
  onInteractionStart: () => void;
  onChange: (cursorMs: number, visibleSpanMs: number) => void;
  onChangeEnd: (cursorMs: number, visibleSpanMs: number) => void;
}

type DragMode = 'left' | 'window' | 'right';

export const OVERVIEW_HANDLE_HIT_WIDTH = 48;
const HANDLE_VISIBLE_WIDTH = 6;
const MINIMUM_VISIBLE_SPAN_MS = 1_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function timelineDuration(clip: SnapCutClip): number {
  return Math.max(0, clip.endMs - clip.startMs);
}

function timeForOverviewX(x: number, width: number, durationMs: number): number {
  return durationMs <= 0 || width <= 0 ? 0 : Math.round((clamp(x, 0, width) / width) * durationMs);
}

export function TimelineOverview({
  clips,
  cursorMs,
  durationMs,
  visibleSpanMs,
  disabled = false,
  onInteractionStart,
  onChange,
  onChangeEnd,
}: TimelineOverviewProps) {
  const [width, setWidth] = useState(0);
  const duration = Math.max(0, Math.round(durationMs));
  const minimumSpan = duration > 0 ? Math.min(MINIMUM_VISIBLE_SPAN_MS, duration) : 0;
  const span = duration > 0 ? clamp(Math.round(visibleSpanMs), minimumSpan, duration) : 0;
  const cursor = clamp(Math.round(cursorMs), 0, duration);
  const visibleStartMs = clamp(cursor - span / 2, 0, duration);
  const visibleEndMs = clamp(cursor + span / 2, 0, duration);
  const left = duration > 0 ? (visibleStartMs / duration) * width : 0;
  const right = duration > 0 ? (visibleEndMs / duration) * width : width;
  const selectionWidth = Math.max(0, right - left);
  const latestRef = useRef({
    cursor,
    left,
    onChange,
    onChangeEnd,
    onInteractionStart,
    right,
    span,
    visibleEndMs,
    visibleStartMs,
  });
  latestRef.current = {
    cursor,
    left,
    onChange,
    onChangeEnd,
    onInteractionStart,
    right,
    span,
    visibleEndMs,
    visibleStartMs,
  };
  const dragRef = useRef({
    mode: 'window' as DragMode,
    cursorMs: cursor,
    resultCursorMs: cursor,
    resultSpanMs: span,
    spanMs: span,
    visibleEndMs,
    visibleStartMs,
  });

  const publishAccessibleChange = (actionName: string) => {
    if (duration <= 0 || disabled) return;
    const stepMs = Math.max(500, span / 10);
    let nextCursorMs = cursor;
    let nextSpanMs = span;
    if (actionName === 'increment' || actionName === 'moveLater') {
      nextCursorMs = clamp(cursor + stepMs, 0, duration);
    } else if (actionName === 'decrement' || actionName === 'moveEarlier') {
      nextCursorMs = clamp(cursor - stepMs, 0, duration);
    } else {
      let nextStartMs = visibleStartMs;
      let nextEndMs = visibleEndMs;
      if (actionName === 'resizeStartEarlier') {
        nextStartMs = clamp(visibleStartMs - stepMs, 0, visibleEndMs - minimumSpan);
      } else if (actionName === 'resizeStartLater') {
        nextStartMs = clamp(visibleStartMs + stepMs, 0, visibleEndMs - minimumSpan);
      } else if (actionName === 'resizeEndEarlier') {
        nextEndMs = clamp(visibleEndMs - stepMs, visibleStartMs + minimumSpan, duration);
      } else if (actionName === 'resizeEndLater') {
        nextEndMs = clamp(visibleEndMs + stepMs, visibleStartMs + minimumSpan, duration);
      } else {
        return;
      }
      nextCursorMs = Math.round((nextStartMs + nextEndMs) / 2);
      nextSpanMs = Math.round(nextEndMs - nextStartMs);
    }
    onInteractionStart();
    onChange(nextCursorMs, nextSpanMs);
    onChangeEnd(nextCursorMs, nextSpanMs);
  };

  const gesture = useMemo(() => {
    const publishChange = (nextCursorMs: number, nextSpanMs: number) => {
      const nextCursor = clamp(Math.round(nextCursorMs), 0, duration);
      const nextSpan = clamp(Math.round(nextSpanMs), minimumSpan, duration);
      dragRef.current.resultCursorMs = nextCursor;
      dragRef.current.resultSpanMs = nextSpan;
      latestRef.current.onChange(nextCursor, nextSpan);
    };
    const publishHandle = (mode: 'left' | 'right', x: number) => {
      const drag = dragRef.current;
      const requestedTimeMs = timeForOverviewX(x, width, duration);
      if (mode === 'left') {
        const nextStartMs = clamp(requestedTimeMs, 0, Math.max(0, drag.visibleEndMs - minimumSpan));
        const nextSpanMs = Math.max(minimumSpan, drag.visibleEndMs - nextStartMs);
        publishChange(Math.round((nextStartMs + drag.visibleEndMs) / 2), nextSpanMs);
        return;
      }
      const nextEndMs = clamp(
        requestedTimeMs,
        Math.min(duration, drag.visibleStartMs + minimumSpan),
        duration,
      );
      const nextSpanMs = Math.max(minimumSpan, nextEndMs - drag.visibleStartMs);
      publishChange(Math.round((drag.visibleStartMs + nextEndMs) / 2), nextSpanMs);
    };
    const pan = Gesture.Pan()
      .enabled(!disabled && duration > 0)
      .maxPointers(1)
      .minDistance(1)
      .withTestId('timeline-overview-drag')
      .onBegin((event) => {
        const latest = latestRef.current;
        const leftDistance = Math.abs(event.x - latest.left);
        const rightDistance = Math.abs(event.x - latest.right);
        let mode: DragMode = 'window';
        if (leftDistance <= OVERVIEW_HANDLE_HIT_WIDTH / 2 && leftDistance <= rightDistance) {
          mode = 'left';
        } else if (rightDistance <= OVERVIEW_HANDLE_HIT_WIDTH / 2) {
          mode = 'right';
        }
        dragRef.current = {
          mode,
          cursorMs: latest.cursor,
          resultCursorMs: latest.cursor,
          resultSpanMs: latest.span,
          spanMs: latest.span,
          visibleEndMs: latest.visibleEndMs,
          visibleStartMs: latest.visibleStartMs,
        };
        latest.onInteractionStart();
      })
      .onUpdate((event) => {
        const drag = dragRef.current;
        if (drag.mode === 'left' || drag.mode === 'right') {
          publishHandle(drag.mode, event.x);
          return;
        }
        const deltaMs = width <= 0 ? 0 : Math.round((event.translationX / width) * duration);
        publishChange(clamp(drag.cursorMs + deltaMs, 0, duration), drag.spanMs);
      })
      .onEnd(() => {
        const drag = dragRef.current;
        latestRef.current.onChangeEnd(drag.resultCursorMs, drag.resultSpanMs);
      })
      .runOnJS(true);
    const tap = Gesture.Tap()
      .enabled(!disabled && duration > 0)
      .maxDistance(3)
      .onEnd((event, success) => {
        if (!success) return;
        const latest = latestRef.current;
        latest.onInteractionStart();
        const nextCursorMs = timeForOverviewX(event.x, width, duration);
        latest.onChange(nextCursorMs, latest.span);
        latest.onChangeEnd(nextCursorMs, latest.span);
      })
      .runOnJS(true);
    return Gesture.Exclusive(pan, tap);
  }, [disabled, duration, minimumSpan, width]);

  return (
    <View style={styles.container} testID="timeline-overview">
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityActions={[
            { name: 'increment', label: 'Move visible range later' },
            { name: 'decrement', label: 'Move visible range earlier' },
            { name: 'resizeStartEarlier', label: 'Move visible start earlier' },
            { name: 'resizeStartLater', label: 'Move visible start later' },
            { name: 'resizeEndEarlier', label: 'Move visible end earlier' },
            { name: 'resizeEndLater', label: 'Move visible end later' },
          ]}
          accessibilityHint="Drag either edge to resize the visible range, or drag the middle to move it."
          accessibilityLabel="Visible timeline range"
          accessibilityRole="adjustable"
          accessibilityState={{ disabled }}
          accessibilityValue={{
            text: `${formatDuration(visibleStartMs)} to ${formatDuration(visibleEndMs)}`,
          }}
          onAccessibilityAction={(event) => publishAccessibleChange(event.nativeEvent.actionName)}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={[styles.track, disabled && styles.disabled]}
          testID="timeline-overview-track"
        >
          <View pointerEvents="none" style={styles.clipMap}>
            {clips.map((clip) => {
              const clipLeft = duration > 0 ? (clip.timelineStartMs / duration) * width : 0;
              const clipWidth = duration > 0 ? (timelineDuration(clip) / duration) * width : 0;
              return (
                <View
                  key={clip.id}
                  style={[
                    styles.overviewClip,
                    clip.trackId === 'track-1' ? styles.trackOneClip : styles.trackTwoClip,
                    { left: clipLeft, width: Math.max(1, clipWidth) },
                  ]}
                />
              );
            })}
          </View>
          <View
            pointerEvents="none"
            style={[styles.selection, { left, width: selectionWidth }]}
            testID="timeline-overview-selection"
          />
          <View
            pointerEvents="none"
            style={[styles.handle, { left: left - HANDLE_VISIBLE_WIDTH / 2 }]}
            testID="timeline-overview-left-handle"
          />
          <View
            pointerEvents="none"
            style={[styles.handle, { left: right - HANDLE_VISIBLE_WIDTH / 2 }]}
            testID="timeline-overview-right-handle"
          />
          <View
            pointerEvents="none"
            style={[styles.cursor, { left: duration > 0 ? (cursor / duration) * width - 1 : -1 }]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: editorWorkspaceLayout.sectionGap,
  },
  track: {
    height: editorWorkspaceLayout.overviewHeight,
    position: 'relative',
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  clipMap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  overviewClip: {
    position: 'absolute',
    height: 12,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
    opacity: 0.7,
  },
  trackOneClip: {
    top: 6,
  },
  trackTwoClip: {
    bottom: 6,
  },
  selection: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderColor: colors.focus,
    borderWidth: 2,
    backgroundColor: colors.accentTranslucent,
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_VISIBLE_WIDTH,
    borderRadius: 3,
    backgroundColor: colors.textPrimary,
  },
  cursor: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.error,
  },
  disabled: {
    opacity: 0.42,
  },
});
