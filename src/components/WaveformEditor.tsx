import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { colors, copy, radii, spacing, typography } from '@/constants';
import type { WaveformFileV1 } from '@/domain';
import type { WaveformLoadState } from '@/stores';
import {
  buildWaveformFillPath,
  buildWaveformOutlinePath,
  getWaveformViewport,
  timeToViewportX,
  viewportXToTime,
} from '@/utils';

import { AppButton } from './AppButton';

const editorHeight = 180;
const handleWidth = 4;

interface WaveformEditorProps {
  waveform: WaveformFileV1 | null;
  loadState: WaveformLoadState;
  durationMs: number;
  startMs: number;
  endMs: number;
  zoom: number;
  viewportStartMs: number;
  playheadMs?: number | null | undefined;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
  onZoomChange: (value: number) => void;
  onViewportStartChange: (deltaMs: number) => void;
}

export function WaveformEditor({
  waveform,
  loadState,
  durationMs,
  startMs,
  endMs,
  zoom,
  viewportStartMs,
  playheadMs = null,
  onStartChange,
  onEndChange,
  onZoomChange,
  onViewportStartChange,
}: WaveformEditorProps) {
  const [width, setWidth] = useState(1);
  const activeHandle = useRef<'start' | 'end'>('start');
  const binCount = waveform?.binCount ?? 8192;
  const viewport = useMemo(
    () => getWaveformViewport(binCount, durationMs, zoom, viewportStartMs),
    [binCount, durationMs, viewportStartMs, zoom],
  );
  const startX = timeToViewportX(startMs, viewport, width);
  const endX = timeToViewportX(endMs, viewport, width);
  const playheadX = playheadMs === null ? null : timeToViewportX(playheadMs, viewport, width);

  const rmsPath = useMemo(
    () =>
      waveform
        ? buildWaveformFillPath(
            waveform.rms,
            width,
            editorHeight,
            viewport.startBin,
            viewport.endBinExclusive,
          )
        : '',
    [viewport.endBinExclusive, viewport.startBin, waveform, width],
  );
  const peakPath = useMemo(
    () =>
      waveform
        ? buildWaveformOutlinePath(
            waveform.peak,
            width,
            editorHeight,
            viewport.startBin,
            viewport.endBinExclusive,
          )
        : '',
    [viewport.endBinExclusive, viewport.startBin, waveform, width],
  );

  // This ref is accessed only by responder callbacks after render. It keeps
  // one handle attached to the full gesture without rerendering each move.
  /* eslint-disable react-hooks/refs */
  const panResponder = useMemo(() => {
    const moveHandle = (x: number) => {
      const timeMs = viewportXToTime(x, viewport, width);
      if (activeHandle.current === 'start') onStartChange(timeMs);
      else onEndChange(timeMs);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const x = event.nativeEvent.locationX;
        const nearestHandle = Math.abs(x - startX) <= Math.abs(x - endX) ? 'start' : 'end';
        activeHandle.current = nearestHandle;
        const timeMs = viewportXToTime(x, viewport, width);
        if (nearestHandle === 'start') onStartChange(timeMs);
        else onEndChange(timeMs);
      },
      onPanResponderMove: (event) => moveHandle(event.nativeEvent.locationX),
    });
  }, [endX, startX, viewport, width, onEndChange, onStartChange]);
  /* eslint-enable react-hooks/refs */

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(Math.max(1, event.nativeEvent.layout.width));
  };
  const visibleDuration = durationMs / Math.max(1, zoom);
  const statusMessage =
    loadState === 'loading' ? copy.editor.waveformLoading : copy.editor.waveformUnavailable;

  return (
    <View>
      <View
        accessibilityLabel={copy.editor.waveformLabel}
        onLayout={onLayout}
        style={styles.canvas}
        testID="waveform-editor"
        {...panResponder.panHandlers}
      >
        <Svg height={editorHeight} pointerEvents="none" width="100%">
          <Rect fill={colors.background} height={editorHeight} width="100%" x={0} y={0} />
          {rmsPath ? (
            <Path d={rmsPath} fill={colors.textSecondary} testID="waveform-rms-path" />
          ) : null}
          {peakPath ? (
            <Path
              d={peakPath}
              fill="none"
              stroke={colors.waveformOverview}
              strokeWidth={1}
              testID="waveform-peak-path"
            />
          ) : null}
          <Rect
            fill={colors.accentTranslucent}
            height={editorHeight}
            width={Math.max(0, endX - startX)}
            x={startX}
            y={0}
          />
          <Line
            stroke={colors.focus}
            strokeWidth={handleWidth}
            x1={startX}
            x2={startX}
            y1={0}
            y2={editorHeight}
          />
          <Line
            stroke={colors.focus}
            strokeWidth={handleWidth}
            x1={endX}
            x2={endX}
            y1={0}
            y2={editorHeight}
          />
          {playheadX === null ? null : (
            <Line
              stroke={colors.error}
              strokeWidth={2}
              x1={playheadX}
              x2={playheadX}
              y1={0}
              y2={editorHeight}
            />
          )}
        </Svg>
        {!waveform ? <Text style={styles.status}>{statusMessage}</Text> : null}
      </View>
      <View style={styles.viewportControls}>
        <AppButton
          disabled={zoom <= 1}
          label={copy.editor.zoomOut}
          onPress={() => onZoomChange(zoom / 2)}
          variant="ghost"
        />
        <Text accessibilityLabel={`Zoom ${copy.editor.zoomLevel(zoom)}`} style={styles.zoomLabel}>
          {copy.editor.zoomLevel(zoom)}
        </Text>
        <AppButton
          disabled={zoom >= 32}
          label={copy.editor.zoomIn}
          onPress={() => onZoomChange(zoom * 2)}
          variant="ghost"
        />
        <AppButton
          disabled={zoom <= 1 || viewport.startMs <= 0}
          label={copy.editor.panEarlier}
          onPress={() => onViewportStartChange(-visibleDuration / 2)}
          variant="ghost"
        />
        <AppButton
          disabled={zoom <= 1 || viewport.endMs >= durationMs}
          label={copy.editor.panLater}
          onPress={() => onViewportStartChange(visibleDuration / 2)}
          variant="ghost"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    height: editorHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  status: {
    ...typography.caption,
    position: 'absolute',
    alignSelf: 'center',
    textAlign: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
  },
  viewportControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  zoomLabel: {
    ...typography.label,
    color: colors.focus,
    minWidth: 36,
    textAlign: 'center',
  },
});
