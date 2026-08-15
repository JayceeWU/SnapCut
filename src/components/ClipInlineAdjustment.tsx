/* eslint-disable react-hooks/refs -- RNGH callbacks read the latest drag contract without recreating an active gesture. */
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { colors, radii, spacing, typography } from '@/constants';
import {
  FADE_DURATION_STEP_MS,
  MAX_FADE_DURATION_MS,
  type FadeDurationMs,
  type SnapCutClip,
} from '@/domain';

import { editorWorkspaceLayout } from './editorWorkspaceLayout';

export type ClipAdjustmentMode = 'volume' | 'fade' | null;

interface AdjustmentSliderProps {
  accessibilityLabel: string;
  accessibilityStep: number;
  disabled: boolean;
  formatValue: (value: number) => string;
  label: string;
  maximum: number;
  minimum?: number;
  onCommit: (value: number) => Promise<boolean>;
  onInteractionStart: () => void;
  onValueChange: (value: number) => void;
  step: number;
  testID: string;
  value: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function snap(value: number, minimum: number, maximum: number, step: number): number {
  const snapped = minimum + Math.round((value - minimum) / step) * step;
  return clamp(snapped, minimum, maximum);
}

function AdjustmentSlider({
  accessibilityLabel,
  accessibilityStep,
  disabled,
  formatValue,
  label,
  maximum,
  minimum = 0,
  onCommit,
  onInteractionStart,
  onValueChange,
  step,
  testID,
  value,
}: AdjustmentSliderProps) {
  const [commitPending, setCommitPending] = useState(false);
  const commitPendingRef = useRef(false);
  const effectivelyDisabled = disabled || commitPending;
  const boundedValue = clamp(value, minimum, maximum);
  const progress = maximum <= minimum ? 0 : (boundedValue - minimum) / (maximum - minimum);
  const configurationRef = useRef({
    accessibilityStep,
    disabled: effectivelyDisabled,
    maximum,
    minimum,
    onCommit,
    onInteractionStart,
    onValueChange,
    step,
    value,
    width: 0,
  });
  configurationRef.current = {
    accessibilityStep,
    disabled: effectivelyDisabled,
    maximum,
    minimum,
    onCommit,
    onInteractionStart,
    onValueChange,
    step,
    value,
    width: configurationRef.current.width,
  };
  const dragInitialValueRef = useRef(value);
  const dragActiveRef = useRef(false);
  const commitValue = useCallback(async (nextValue: number, previousValue: number) => {
    if (nextValue === previousValue || commitPendingRef.current) return;
    commitPendingRef.current = true;
    setCommitPending(true);
    let committed = false;
    try {
      committed = await configurationRef.current.onCommit(nextValue);
    } catch {
      committed = false;
    }
    if (!committed) configurationRef.current.onValueChange(previousValue);
    commitPendingRef.current = false;
    setCommitPending(false);
  }, []);
  const gesture = useMemo(() => {
    const valueForX = (x: number) => {
      const configuration = configurationRef.current;
      return snap(
        configuration.minimum +
          (clamp(x, 0, configuration.width) / Math.max(1, configuration.width)) *
            (configuration.maximum - configuration.minimum),
        configuration.minimum,
        configuration.maximum,
        configuration.step,
      );
    };
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(1)
      .withTestId(`${testID}-drag`)
      .onBegin(() => {
        const configuration = configurationRef.current;
        if (
          configuration.disabled ||
          commitPendingRef.current ||
          configuration.maximum <= configuration.minimum
        )
          return;
        dragInitialValueRef.current = configuration.value;
        dragActiveRef.current = true;
        configuration.onInteractionStart();
      })
      .onUpdate((event) => {
        const configuration = configurationRef.current;
        if (
          configuration.disabled ||
          commitPendingRef.current ||
          configuration.maximum <= configuration.minimum
        )
          return;
        configuration.onValueChange(valueForX(event.x));
      })
      .onEnd((event, success) => {
        const configuration = configurationRef.current;
        if (
          configuration.disabled ||
          commitPendingRef.current ||
          configuration.maximum <= configuration.minimum
        )
          return;
        if (!success) {
          dragActiveRef.current = false;
          configuration.onValueChange(dragInitialValueRef.current);
          return;
        }
        dragActiveRef.current = false;
        const nextValue = valueForX(event.x);
        configuration.onValueChange(nextValue);
        if (nextValue !== dragInitialValueRef.current) {
          void commitValue(nextValue, dragInitialValueRef.current);
        }
      })
      .onFinalize((_event, success) => {
        if (success || !dragActiveRef.current) return;
        dragActiveRef.current = false;
        configurationRef.current.onValueChange(dragInitialValueRef.current);
      })
      .runOnJS(true);
    const tap = Gesture.Tap()
      .onEnd((event, success) => {
        if (!success) return;
        const configuration = configurationRef.current;
        if (
          configuration.disabled ||
          commitPendingRef.current ||
          configuration.maximum <= configuration.minimum
        )
          return;
        configuration.onInteractionStart();
        const previousValue = configuration.value;
        const nextValue = valueForX(event.x);
        configuration.onValueChange(nextValue);
        if (nextValue !== previousValue) void commitValue(nextValue, previousValue);
      })
      .runOnJS(true);
    return Gesture.Exclusive(pan, tap);
  }, [commitValue, testID]);
  const adjustAccessibly = (direction: -1 | 1) => {
    const configuration = configurationRef.current;
    if (configuration.disabled || commitPendingRef.current) return;
    configuration.onInteractionStart();
    const previousValue = configuration.value;
    const nextValue = snap(
      configuration.value + direction * configuration.accessibilityStep,
      configuration.minimum,
      configuration.maximum,
      configuration.step,
    );
    configuration.onValueChange(nextValue);
    if (nextValue !== previousValue) void commitValue(nextValue, previousValue);
  };

  return (
    <View style={styles.sliderRow} testID={testID}>
      <View pointerEvents="none" style={styles.sliderLabelRow}>
        <Text numberOfLines={1} style={styles.sliderLabel}>
          {label}
        </Text>
        <Text numberOfLines={1} style={styles.sliderValue}>
          {formatValue(boundedValue)}
        </Text>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="adjustable"
          accessibilityState={{ busy: commitPending, disabled: effectivelyDisabled }}
          accessibilityValue={{ min: minimum, max: maximum, now: boundedValue }}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') adjustAccessibly(1);
            if (event.nativeEvent.actionName === 'decrement') adjustAccessibly(-1);
          }}
          onLayout={(event) => {
            configurationRef.current.width = event.nativeEvent.layout.width;
          }}
          style={[styles.sliderTouchArea, effectivelyDisabled && styles.disabled]}
        >
          <View pointerEvents="none" style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${progress * 100}%` }]} />
          </View>
          <View pointerEvents="none" style={[styles.sliderThumb, { left: `${progress * 100}%` }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

export interface ClipInlineAdjustmentProps {
  busy?: boolean;
  clip: SnapCutClip | null;
  mode: ClipAdjustmentMode;
  onCommitFades: (fadeInMs: FadeDurationMs, fadeOutMs: FadeDurationMs) => Promise<boolean>;
  onCommitVolume: (gain: number) => Promise<boolean>;
  onInteractionStart: () => void;
}

type ClipInlineAdjustmentPanelProps = Omit<ClipInlineAdjustmentProps, 'clip' | 'mode'> & {
  clip: SnapCutClip;
  mode: Exclude<ClipAdjustmentMode, null>;
};

function ClipInlineAdjustmentPanel({
  busy = false,
  clip,
  mode,
  onCommitFades,
  onCommitVolume,
  onInteractionStart,
}: ClipInlineAdjustmentPanelProps) {
  const [volumePercent, setVolumePercent] = useState(() => Math.round(clip.gain * 100));
  const [fadeInMs, setFadeInMs] = useState<FadeDurationMs>(clip.fadeInMs);
  const [fadeOutMs, setFadeOutMs] = useState<FadeDurationMs>(clip.fadeOutMs);
  const clipDurationMs = Math.max(0, clip.endMs - clip.startMs);
  const maximumFadeInMs =
    Math.floor(Math.min(MAX_FADE_DURATION_MS, clipDurationMs - fadeOutMs) / FADE_DURATION_STEP_MS) *
    FADE_DURATION_STEP_MS;
  const maximumFadeOutMs =
    Math.floor(Math.min(MAX_FADE_DURATION_MS, clipDurationMs - fadeInMs) / FADE_DURATION_STEP_MS) *
    FADE_DURATION_STEP_MS;
  const formatFade = (value: number) => `${Number((value / 1_000).toFixed(1))}s`;

  return (
    <View
      style={[styles.container, mode === 'fade' ? styles.fadeContainer : styles.volumeContainer]}
      testID={`clip-inline-${mode}`}
    >
      {mode === 'volume' ? (
        <AdjustmentSlider
          accessibilityLabel="Clip volume"
          accessibilityStep={5}
          disabled={busy}
          formatValue={(value) => `${Math.round(value)}%`}
          label="Volume"
          maximum={100}
          onCommit={(value) => onCommitVolume(value / 100)}
          onInteractionStart={onInteractionStart}
          onValueChange={setVolumePercent}
          step={1}
          testID="clip-volume-slider"
          value={volumePercent}
        />
      ) : (
        <>
          <AdjustmentSlider
            accessibilityLabel="Fade in duration"
            accessibilityStep={FADE_DURATION_STEP_MS}
            disabled={busy}
            formatValue={formatFade}
            label="Fade In"
            maximum={maximumFadeInMs}
            onCommit={(value) => onCommitFades(value as FadeDurationMs, fadeOutMs)}
            onInteractionStart={onInteractionStart}
            onValueChange={(value) => setFadeInMs(value as FadeDurationMs)}
            step={FADE_DURATION_STEP_MS}
            testID="clip-fade-in-slider"
            value={fadeInMs}
          />
          <AdjustmentSlider
            accessibilityLabel="Fade out duration"
            accessibilityStep={FADE_DURATION_STEP_MS}
            disabled={busy}
            formatValue={formatFade}
            label="Fade Out"
            maximum={maximumFadeOutMs}
            onCommit={(value) => onCommitFades(fadeInMs, value as FadeDurationMs)}
            onInteractionStart={onInteractionStart}
            onValueChange={(value) => setFadeOutMs(value as FadeDurationMs)}
            step={FADE_DURATION_STEP_MS}
            testID="clip-fade-out-slider"
            value={fadeOutMs}
          />
        </>
      )}
    </View>
  );
}

export function ClipInlineAdjustment(props: ClipInlineAdjustmentProps) {
  const { clip, mode } = props;
  if (!clip || mode === null) return null;
  return (
    <ClipInlineAdjustmentPanel
      {...props}
      clip={clip}
      key={`${clip.id}:${mode}:${clip.gain}:${clip.fadeInMs}:${clip.fadeOutMs}`}
      mode={mode}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: editorWorkspaceLayout.sectionGap,
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  volumeContainer: {
    height: editorWorkspaceLayout.volumePanelHeight,
  },
  fadeContainer: {
    height: editorWorkspaceLayout.fadePanelHeight,
  },
  sliderRow: {
    height: editorWorkspaceLayout.inlineSliderHeight,
    position: 'relative',
  },
  sliderLabelRow: {
    position: 'absolute',
    zIndex: 1,
    top: 0,
    right: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  sliderValue: {
    ...typography.caption,
    color: colors.focus,
    fontVariant: ['tabular-nums'],
  },
  sliderTouchArea: {
    height: editorWorkspaceLayout.inlineSliderHeight,
    position: 'relative',
    justifyContent: 'flex-end',
    paddingBottom: spacing.xs,
  },
  sliderTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: colors.disabledSurface,
  },
  sliderFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  sliderThumb: {
    position: 'absolute',
    bottom: 2,
    width: 16,
    height: 16,
    marginLeft: -8,
    borderColor: colors.textPrimary,
    borderWidth: 2,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  disabled: {
    opacity: 0.42,
  },
});
