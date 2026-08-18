import { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { colors, minimumTouchTarget, radii, spacing, typography } from '@/constants';
import type { WaveformFile } from '@/domain';
import { formatTimelineTime } from '@/utils/time';
import { buildWaveformFillPath } from '@/utils/waveform';

const WAVEFORM_HEIGHT = 96;

interface ClipSourceWaveformProps {
  cursorMs: number;
  disabled: boolean;
  durationMs: number;
  loading: boolean;
  playing: boolean;
  waveform: WaveformFile | null;
  onCursorChange: (positionMs: number) => void;
  onScrubEnd: (positionMs: number) => void;
  onScrubStart: () => void;
  onTogglePlayback: () => void;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d={playing ? 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z' : 'M7 4v16l12-8L7 4Z'}
        fill={colors.textPrimary}
      />
    </Svg>
  );
}

export function ClipSourceWaveform({
  cursorMs,
  disabled,
  durationMs,
  loading,
  playing,
  waveform,
  onCursorChange,
  onScrubEnd,
  onScrubStart,
  onTogglePlayback,
}: ClipSourceWaveformProps) {
  const [width, setWidth] = useState(0);
  const lastDraftMs = useRef(cursorMs);
  const path = useMemo(
    () =>
      waveform
        ? buildWaveformFillPath(waveform.rms, width, WAVEFORM_HEIGHT, 0, waveform.binCount)
        : '',
    [waveform, width],
  );
  const safeCursorMs = clamp(Math.round(cursorMs), 0, durationMs);
  const cursorX = durationMs > 0 ? (safeCursorMs / durationMs) * width : 0;

  const eventPosition = (event: NativeSyntheticEvent<NativeTouchEvent>): number => {
    if (width <= 0 || durationMs <= 0) return 0;
    return Math.round((clamp(event.nativeEvent.locationX, 0, width) / width) * durationMs);
  };

  const update = (event: NativeSyntheticEvent<NativeTouchEvent>): number => {
    const positionMs = eventPosition(event);
    lastDraftMs.current = positionMs;
    onCursorChange(positionMs);
    return positionMs;
  };

  const nudge = (deltaMs: number) => {
    if (disabled) return;
    const next = clamp(safeCursorMs + deltaMs, 0, durationMs);
    onScrubStart();
    onCursorChange(next);
    onScrubEnd(next);
  };

  return (
    <View style={styles.wrapper}>
      <View
        accessibilityActions={[
          { name: 'increment', label: 'Move play position later' },
          { name: 'decrement', label: 'Move play position earlier' },
        ]}
        accessibilityLabel="Source waveform play position"
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityValue={{ min: 0, max: durationMs, now: safeCursorMs }}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === 'increment') nudge(100);
          if (nativeEvent.actionName === 'decrement') nudge(-100);
        }}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        onTouchCancel={() => {
          if (!disabled) onScrubEnd(lastDraftMs.current);
        }}
        onTouchEnd={(event) => {
          if (disabled) return;
          onScrubEnd(update(event));
        }}
        onTouchMove={(event) => {
          if (!disabled) update(event);
        }}
        onTouchStart={(event) => {
          if (disabled) return;
          onScrubStart();
          update(event);
        }}
        style={[styles.waveform, disabled && styles.disabled]}
        testID="clip-source-waveform"
      >
        <Svg height={WAVEFORM_HEIGHT} pointerEvents="none" width="100%">
          <Rect fill={colors.background} height="100%" rx={radii.md} width="100%" />
          <Line
            stroke={colors.border}
            strokeWidth={1}
            x1={0}
            x2={width}
            y1={WAVEFORM_HEIGHT / 2}
            y2={WAVEFORM_HEIGHT / 2}
          />
          {path ? <Path d={path} fill={colors.focus} opacity={0.88} /> : null}
          <Line
            stroke={colors.textPrimary}
            strokeWidth={2}
            x1={cursorX}
            x2={cursorX}
            y1={0}
            y2={WAVEFORM_HEIGHT}
          />
        </Svg>
      </View>
      <View style={styles.transport}>
        <Text style={styles.time} testID="clip-source-cursor-time">
          {formatTimelineTime(safeCursorMs)}
        </Text>
        <Pressable
          accessibilityLabel={playing || loading ? 'Pause source' : 'Play source from cursor'}
          accessibilityRole="button"
          accessibilityState={{ busy: loading, disabled }}
          disabled={disabled}
          onPress={onTogglePlayback}
          style={({ pressed }) => [
            styles.playButton,
            disabled && styles.disabled,
            pressed && !disabled && styles.pressed,
          ]}
          testID="clip-source-playback"
        >
          <PlayIcon playing={playing || loading} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  waveform: {
    height: WAVEFORM_HEIGHT,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  transport: {
    minHeight: minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  time: { ...typography.body, fontVariant: ['tabular-nums'] },
  playButton: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.soft,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
