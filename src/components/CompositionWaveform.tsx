import { useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { colors, layout, radii, spacing, typography } from '@/constants';
import type { SnapCutClip, SnapCutSource, WaveformFile } from '@/domain';
import { buildWaveformFillPath } from '@/utils/waveform';

const COMPOSITION_WAVEFORM_HEIGHT = 132;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

interface CompositionWaveformSegment {
  clipId: string;
  x: number;
  width: number;
  path: string | null;
}

export function compositionDurationFromClips(clips: readonly SnapCutClip[]): number {
  return clips.reduce((total, clip) => total + Math.max(0, clip.endMs - clip.startMs), 0);
}

/** Builds one bounded SVG path per clip; media samples never enter this component. */
export function buildCompositionWaveformSegments(
  clips: readonly SnapCutClip[],
  sources: readonly SnapCutSource[],
  waveformsBySourceId: Readonly<Record<string, WaveformFile | null>>,
  width: number,
  height: number,
): CompositionWaveformSegment[] {
  const totalDurationMs = compositionDurationFromClips(clips);
  if (width <= 0 || height <= 0 || totalDurationMs <= 0) return [];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  let elapsedMs = 0;

  return clips.map((clip) => {
    const durationMs = Math.max(0, clip.endMs - clip.startMs);
    const x = (elapsedMs / totalDurationMs) * width;
    const segmentWidth = (durationMs / totalDurationMs) * width;
    elapsedMs += durationMs;

    const source = sourcesById.get(clip.sourceId);
    const waveform = waveformsBySourceId[clip.sourceId];
    if (!source || !waveform || waveform.rms.length === 0 || source.durationMs <= 0) {
      return { clipId: clip.id, x, width: segmentWidth, path: null };
    }

    const binCount = waveform.rms.length;
    const startBin = clamp(
      Math.floor((clip.startMs / source.durationMs) * binCount),
      0,
      Math.max(0, binCount - 1),
    );
    const endBinExclusive = clamp(
      Math.ceil((clip.endMs / source.durationMs) * binCount),
      startBin + 1,
      binCount,
    );
    const maximumPoints = Math.max(2, Math.min(512, Math.ceil(segmentWidth * 2)));
    return {
      clipId: clip.id,
      x,
      width: segmentWidth,
      path: buildWaveformFillPath(
        waveform.rms,
        segmentWidth,
        height,
        startBin,
        endBinExclusive,
        maximumPoints,
      ),
    };
  });
}

interface CompositionWaveformProps {
  clips: readonly SnapCutClip[];
  sources: readonly SnapCutSource[];
  waveformsBySourceId: Readonly<Record<string, WaveformFile | null>>;
  cursorMs: number;
  disabled?: boolean;
  onScrubStart: () => void;
  onScrubChange: (positionMs: number) => void;
  onScrubEnd: (positionMs: number) => void;
}

function eventPosition(
  event: NativeSyntheticEvent<NativeTouchEvent>,
  width: number,
  durationMs: number,
): number {
  if (width <= 0 || durationMs <= 0) return 0;
  return Math.round((clamp(event.nativeEvent.locationX, 0, width) / width) * durationMs);
}

export function CompositionWaveform({
  clips,
  sources,
  waveformsBySourceId,
  cursorMs,
  disabled = false,
  onScrubStart,
  onScrubChange,
  onScrubEnd,
}: CompositionWaveformProps) {
  const [width, setWidth] = useState(0);
  const lastDraftMs = useRef(0);
  const durationMs = compositionDurationFromClips(clips);
  const segments = useMemo(
    () =>
      buildCompositionWaveformSegments(
        clips,
        sources,
        waveformsBySourceId,
        width,
        COMPOSITION_WAVEFORM_HEIGHT,
      ),
    [clips, sources, waveformsBySourceId, width],
  );

  const updateFromEvent = (event: NativeSyntheticEvent<NativeTouchEvent>): number => {
    const positionMs = eventPosition(event, width, durationMs);
    lastDraftMs.current = positionMs;
    onScrubChange(positionMs);
    return positionMs;
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(0, event.nativeEvent.layout.width);
    setWidth(nextWidth);
  };
  const cursorX = durationMs > 0 ? (clamp(cursorMs, 0, durationMs) / durationMs) * width : 0;

  const nudgeCursor = (deltaMs: number) => {
    if (disabled || durationMs <= 0) return;
    const next = clamp(Math.round(cursorMs + deltaMs), 0, durationMs);
    onScrubStart();
    onScrubChange(next);
    onScrubEnd(next);
  };

  return (
    <View
      accessibilityActions={[
        { name: 'increment', label: 'Move play position later' },
        { name: 'decrement', label: 'Move play position earlier' },
      ]}
      accessibilityLabel="Composition waveform"
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{ min: 0, max: durationMs, now: Math.round(cursorMs) }}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'increment') nudgeCursor(1_000);
        if (nativeEvent.actionName === 'decrement') nudgeCursor(-1_000);
      }}
      onLayout={onLayout}
      onTouchCancel={() => {
        if (!disabled && durationMs > 0) onScrubEnd(lastDraftMs.current);
      }}
      onTouchEnd={(event) => {
        if (disabled || durationMs <= 0) return;
        const positionMs = updateFromEvent(event);
        onScrubEnd(positionMs);
      }}
      onTouchMove={(event) => {
        if (!disabled && durationMs > 0) updateFromEvent(event);
      }}
      onTouchStart={(event) => {
        if (disabled || durationMs <= 0) return;
        onScrubStart();
        updateFromEvent(event);
      }}
      style={[styles.container, disabled && styles.disabled]}
      testID="composition-waveform"
    >
      {durationMs === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No clips yet</Text>
          <Text style={styles.emptyMessage}>Add a clip to build your composition.</Text>
        </View>
      ) : (
        <Svg
          height={COMPOSITION_WAVEFORM_HEIGHT}
          pointerEvents="none"
          testID="composition-waveform-svg"
          width="100%"
        >
          <Rect fill={colors.surface} height="100%" rx={radii.md} width="100%" />
          <Line
            stroke={colors.border}
            strokeWidth={1}
            x1={0}
            x2={width}
            y1={COMPOSITION_WAVEFORM_HEIGHT / 2}
            y2={COMPOSITION_WAVEFORM_HEIGHT / 2}
          />
          {segments.map((segment) =>
            segment.path ? (
              <Path
                d={segment.path}
                fill={colors.focus}
                key={segment.clipId}
                opacity={0.9}
                transform={`translate(${segment.x} 0)`}
              />
            ) : (
              <Rect
                fill={colors.soft}
                height={COMPOSITION_WAVEFORM_HEIGHT}
                key={segment.clipId}
                opacity={0.9}
                width={Math.max(1, segment.width)}
                x={segment.x}
                y={0}
              />
            ),
          )}
          {segments.slice(1).map((segment) => (
            <Line
              key={`boundary-${segment.clipId}`}
              stroke={colors.background}
              strokeWidth={2}
              x1={segment.x}
              x2={segment.x}
              y1={0}
              y2={COMPOSITION_WAVEFORM_HEIGHT}
            />
          ))}
          <Line
            stroke={colors.error}
            strokeWidth={2}
            x1={cursorX}
            x2={cursorX}
            y1={0}
            y2={COMPOSITION_WAVEFORM_HEIGHT}
          />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...layout.card,
    height: COMPOSITION_WAVEFORM_HEIGHT,
    overflow: 'hidden',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  emptyTitle: {
    ...typography.cardTitle,
  },
  emptyMessage: {
    ...typography.caption,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.7,
  },
});
