import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { colors, layout, minimumTouchTarget, radii, spacing, typography } from '@/constants';
import {
  COMPARISON_PREVIEW_CONTEXT_MS,
  type SnapCutSource,
  type SourceComparisonBookmark,
  type WaveformFile,
} from '@/domain';
import {
  clampComparisonTime,
  comparisonVisibleSpanBounds,
  comparisonResultDurationMs,
  comparisonResultPath,
  comparisonResultSourceTimeMs,
  comparisonWindowPath,
  defaultComparisonVisibleSpan,
  initialComparisonPositions,
  snapComparisonVisibleSpan,
} from '@/utils/sourceComparison';
import { formatTimelineTime } from '@/utils/time';
import { buildWaveformFillPath } from '@/utils/waveform';

import { ErrorBanner } from './ErrorBanner';

const OVERVIEW_HEIGHT = 44;
const LOCAL_WAVEFORM_HEIGHT = 78;
const RESULT_WAVEFORM_HEIGHT = 68;

export type ComparisonPreviewKind = 'transition' | 'result' | null;

interface SourceComparisonModalProps {
  visible: boolean;
  source: SnapCutSource;
  waveform: WaveformFile;
  bookmark: SourceComparisonBookmark | null;
  busy?: boolean;
  previewLoading?: boolean;
  previewPlaying?: boolean;
  previewKind?: ComparisonPreviewKind;
  selectionPlaybackPositionMs?: number | null;
  operationError?: string | null;
  onClose: () => void;
  onDismissError?: () => void;
  onInteractionStart: () => void;
  onPreview: (firstMs: number, secondMs: number) => void;
  onResultPreview: (firstMs: number, secondMs: number, startPositionMs: number) => void;
  onResultScrubEnd: (positionMs: number) => void;
  onResultScrubStart: () => void;
  onSet: (firstMs: number, secondMs: number) => Promise<boolean>;
  onAddClips: (bookmark: SourceComparisonBookmark) => void;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

function CloseIcon() {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M6 6l12 12M18 6 6 18"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

function PreviewIcon({ pause }: { pause: boolean }) {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d={pause ? 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z' : 'M7 4v16l12-8L7 4Z'}
        fill={colors.textPrimary}
      />
    </Svg>
  );
}

function ComparisonPreviewIcon({ pause }: { pause: boolean }) {
  return (
    <Svg height={24} viewBox="0 0 28 24" width={28}>
      <Path
        d="M1 7h7M5 3l4 4-4 4M27 17h-7M23 13l-4 4 4 4"
        fill="none"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
      <Path
        d={pause ? 'M11 5h3v14h-3V5Zm5 0h3v14h-3V5Z' : 'M11 4v16l9-8-9-8Z'}
        fill={colors.textPrimary}
      />
    </Svg>
  );
}

interface OverviewProps {
  label: string;
  waveform: WaveformFile;
  durationMs: number;
  centerMs: number;
  visibleSpanMs: number;
  disabled: boolean;
  onInteractionStart: () => void;
  onChange: (value: number) => void;
}

function SourceOverview({
  label,
  waveform,
  durationMs,
  centerMs,
  visibleSpanMs,
  disabled,
  onInteractionStart,
  onChange,
}: OverviewProps) {
  const [width, setWidth] = useState(0);
  const path = useMemo(
    () => buildWaveformFillPath(waveform.rms, width, OVERVIEW_HEIGHT, 0, waveform.rms.length, 512),
    [waveform.rms, width],
  );
  const update = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (disabled || width <= 0) return;
    onChange(clampComparisonTime((event.nativeEvent.locationX / width) * durationMs, durationMs));
  };
  const halfSpan = visibleSpanMs / 2;
  const selectionStart = clamp(centerMs - halfSpan, 0, durationMs);
  const selectionEnd = clamp(centerMs + halfSpan, 0, durationMs);
  const selectionX = durationMs > 0 ? (selectionStart / durationMs) * width : 0;
  const selectionWidth =
    durationMs > 0 ? ((selectionEnd - selectionStart) / durationMs) * width : 0;

  return (
    <View
      accessibilityActions={[
        { name: 'increment', label: 'Move later' },
        { name: 'decrement', label: 'Move earlier' },
      ]}
      accessibilityLabel={label}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{ min: 0, max: durationMs, now: centerMs }}
      onAccessibilityAction={({ nativeEvent }) => {
        if (disabled) return;
        onInteractionStart();
        const delta = nativeEvent.actionName === 'increment' ? 100 : -100;
        onChange(clampComparisonTime(centerMs + delta, durationMs));
      }}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      onTouchMove={update}
      onTouchStart={(event) => {
        onInteractionStart();
        update(event);
      }}
      style={[styles.overview, disabled && styles.disabled]}
      testID={
        label === 'First source position'
          ? 'comparison-first-overview'
          : 'comparison-second-overview'
      }
    >
      <Svg height={OVERVIEW_HEIGHT} pointerEvents="none" width="100%">
        <Rect fill={colors.background} height="100%" width="100%" />
        {path ? <Path d={path} fill={colors.waveformOverview} /> : null}
        <Rect
          fill={colors.accentTranslucent}
          height="100%"
          stroke={colors.focus}
          strokeWidth={2}
          width={Math.max(2, selectionWidth)}
          x={selectionX}
        />
        <Line
          stroke={colors.error}
          strokeWidth={2}
          x1={(centerMs / durationMs) * width}
          x2={(centerMs / durationMs) * width}
          y1={0}
          y2={OVERVIEW_HEIGHT}
        />
      </Svg>
    </View>
  );
}

function LocalWaveform({
  waveform,
  durationMs,
  centerMs,
  visibleSpanMs,
  disabled,
  label,
  onChange,
  onInteractionStart,
  testID,
}: {
  waveform: WaveformFile;
  durationMs: number;
  centerMs: number;
  visibleSpanMs: number;
  disabled: boolean;
  label: string;
  onChange: (value: number) => void;
  onInteractionStart: () => void;
  testID: string;
}) {
  const [width, setWidth] = useState(0);
  const drag = useRef<{ locationX: number; centerMs: number } | null>(null);
  const path = useMemo(
    () =>
      comparisonWindowPath(
        waveform,
        durationMs,
        centerMs,
        visibleSpanMs,
        width,
        LOCAL_WAVEFORM_HEIGHT,
      ),
    [centerMs, durationMs, visibleSpanMs, waveform, width],
  );
  const updateDrag = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (disabled || width <= 0 || drag.current === null) return;
    const deltaX = event.nativeEvent.locationX - drag.current.locationX;
    onChange(
      clampComparisonTime(drag.current.centerMs - (deltaX / width) * visibleSpanMs, durationMs),
    );
  };
  return (
    <View
      accessibilityActions={[
        { name: 'increment', label: 'Move later' },
        { name: 'decrement', label: 'Move earlier' },
      ]}
      accessibilityLabel={label}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{ min: 0, max: durationMs, now: centerMs }}
      onAccessibilityAction={({ nativeEvent }) => {
        if (disabled) return;
        onInteractionStart();
        onChange(
          clampComparisonTime(
            centerMs + (nativeEvent.actionName === 'increment' ? 10 : -10),
            durationMs,
          ),
        );
      }}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      onTouchEnd={(event) => {
        updateDrag(event);
        drag.current = null;
      }}
      onTouchMove={updateDrag}
      onTouchStart={(event) => {
        if (disabled || width <= 0) return;
        onInteractionStart();
        drag.current = { locationX: event.nativeEvent.locationX, centerMs };
      }}
      style={[styles.localWaveform, disabled && styles.disabled]}
      testID={testID}
    >
      <Svg height={LOCAL_WAVEFORM_HEIGHT} pointerEvents="none" width="100%">
        <Rect fill={colors.background} height="100%" width="100%" />
        {path ? <Path d={path} fill={colors.focus} /> : null}
      </Svg>
    </View>
  );
}

function SpanSlider({
  durationMs,
  value,
  disabled,
  onInteractionStart,
  onChange,
}: {
  durationMs: number;
  value: number;
  disabled: boolean;
  onInteractionStart: () => void;
  onChange: (value: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const bounds = comparisonVisibleSpanBounds(durationMs);
  const range = Math.max(1, bounds.maximum - bounds.minimum);
  const x = ((value - bounds.minimum) / range) * width;
  const update = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (disabled || width <= 0) return;
    const ratio = clamp(event.nativeEvent.locationX / width, 0, 1);
    onChange(snapComparisonVisibleSpan(bounds.minimum + ratio * range, durationMs));
  };
  return (
    <View style={styles.sliderRow}>
      <View
        accessibilityActions={[
          { name: 'increment', label: 'Show a longer interval' },
          { name: 'decrement', label: 'Show a shorter interval' },
        ]}
        accessibilityLabel="Shared comparison interval"
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: bounds.minimum,
          max: bounds.maximum,
          now: value,
          text: `${value / 1_000} seconds`,
        }}
        onAccessibilityAction={({ nativeEvent }) => {
          if (disabled) return;
          onInteractionStart();
          const next = value + (nativeEvent.actionName === 'increment' ? 1_000 : -1_000);
          onChange(snapComparisonVisibleSpan(next, durationMs));
        }}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        onTouchMove={update}
        onTouchStart={(event) => {
          onInteractionStart();
          update(event);
        }}
        style={[styles.slider, disabled && styles.disabled]}
        testID="comparison-span-slider"
      >
        <View pointerEvents="none" style={styles.sliderTrack} />
        <View pointerEvents="none" style={[styles.sliderFill, { width: Math.max(0, x) }]} />
        <View
          pointerEvents="none"
          style={[styles.sliderThumb, { left: clamp(x - 10, 0, Math.max(0, width - 20)) }]}
        />
      </View>
      <Text style={styles.spanValue} testID="comparison-span-value">
        {value / 1_000}s
      </Text>
    </View>
  );
}

function ComparisonResultWaveform({
  waveform,
  durationMs,
  firstMs,
  secondMs,
  cursorMs,
  disabled,
  loading,
  playing,
  onCursorChange,
  onPreview,
  onScrubEnd,
  onScrubStart,
}: {
  waveform: WaveformFile;
  durationMs: number;
  firstMs: number;
  secondMs: number;
  cursorMs: number;
  disabled: boolean;
  loading: boolean;
  playing: boolean;
  onCursorChange: (value: number) => void;
  onPreview: () => void;
  onScrubEnd: (value: number) => void;
  onScrubStart: () => void;
}) {
  const [width, setWidth] = useState(0);
  const scrubbing = useRef(false);
  const resultDurationMs = comparisonResultDurationMs(durationMs, firstMs, secondMs);
  const path = useMemo(
    () =>
      comparisonResultPath(waveform, durationMs, firstMs, secondMs, width, RESULT_WAVEFORM_HEIGHT),
    [durationMs, firstMs, secondMs, waveform, width],
  );
  const positionForEvent = (event: NativeSyntheticEvent<NativeTouchEvent>): number =>
    clampComparisonTime(
      (event.nativeEvent.locationX / Math.max(1, width)) * resultDurationMs,
      resultDurationMs,
    );
  const cursorX = resultDurationMs > 0 ? (cursorMs / resultDurationMs) * width : 0;
  const seamX = resultDurationMs > 0 ? (firstMs / resultDurationMs) * width : 0;
  const sourceCursorMs = comparisonResultSourceTimeMs(cursorMs, firstMs, secondMs);

  return (
    <View style={styles.resultRow}>
      <View
        accessibilityActions={[
          { name: 'increment', label: 'Move later' },
          { name: 'decrement', label: 'Move earlier' },
        ]}
        accessibilityLabel="Comparison result playback position"
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityValue={{ min: 0, max: resultDurationMs, now: cursorMs }}
        onAccessibilityAction={({ nativeEvent }) => {
          if (disabled) return;
          onScrubStart();
          const next = clampComparisonTime(
            cursorMs + (nativeEvent.actionName === 'increment' ? 100 : -100),
            resultDurationMs,
          );
          onCursorChange(next);
          onScrubEnd(next);
        }}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        onTouchEnd={(event) => {
          if (!scrubbing.current) return;
          const next = positionForEvent(event);
          scrubbing.current = false;
          onCursorChange(next);
          onScrubEnd(next);
        }}
        onTouchMove={(event) => {
          if (!scrubbing.current) return;
          onCursorChange(positionForEvent(event));
        }}
        onTouchStart={(event) => {
          if (disabled || width <= 0) return;
          scrubbing.current = true;
          onScrubStart();
          onCursorChange(positionForEvent(event));
        }}
        style={[styles.resultWaveform, disabled && styles.disabled]}
        testID="comparison-result-waveform"
      >
        <Svg height={RESULT_WAVEFORM_HEIGHT} pointerEvents="none" width="100%">
          <Rect fill={colors.background} height="100%" width="100%" />
          {path ? <Path d={path} fill={colors.focus} /> : null}
          <Line
            stroke={colors.border}
            strokeDasharray="3 3"
            strokeWidth={1}
            x1={seamX}
            x2={seamX}
            y1={0}
            y2={RESULT_WAVEFORM_HEIGHT}
          />
          <Line
            stroke={colors.textPrimary}
            strokeWidth={2}
            x1={cursorX}
            x2={cursorX}
            y1={0}
            y2={RESULT_WAVEFORM_HEIGHT}
          />
        </Svg>
      </View>
      <View style={styles.resultControl}>
        <Pressable
          accessibilityLabel={playing ? 'Pause comparison result' : 'Play comparison result'}
          accessibilityRole="button"
          accessibilityState={{ busy: loading, disabled }}
          disabled={disabled}
          onPress={onPreview}
          style={[styles.resultPlayButton, disabled && styles.disabled]}
          testID="comparison-result-play"
        >
          {loading ? (
            <ActivityIndicator color={colors.textPrimary} size="small" />
          ) : (
            <PreviewIcon pause={playing} />
          )}
        </Pressable>
        <Text style={styles.resultSourceTime} testID="comparison-result-source-time">
          {formatTimelineTime(sourceCursorMs)}
        </Text>
      </View>
    </View>
  );
}

export function SourceComparisonModal({
  visible,
  source,
  waveform,
  bookmark,
  busy = false,
  previewLoading = false,
  previewPlaying = false,
  previewKind = null,
  selectionPlaybackPositionMs = null,
  operationError = null,
  onClose,
  onDismissError,
  onInteractionStart,
  onPreview,
  onResultPreview,
  onResultScrubEnd,
  onResultScrubStart,
  onSet,
  onAddClips,
}: SourceComparisonModalProps) {
  const initial = initialComparisonPositions(source.durationMs, bookmark);
  const [firstMs, setFirstMs] = useState(initial.firstMs);
  const [secondMs, setSecondMs] = useState(initial.secondMs);
  const [visibleSpanMs, setVisibleSpanMs] = useState(
    defaultComparisonVisibleSpan(source.durationMs),
  );
  const [resultCursorMs, setResultCursorMs] = useState(Math.max(0, initial.firstMs - 3_000));
  const [resultScrubbingActive, setResultScrubbingActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const controlsDisabled = busy || saving;
  const currentPointsValid =
    firstMs >= 100 && firstMs < secondMs && source.durationMs - secondMs >= 100;
  const resultDurationMs = comparisonResultDurationMs(source.durationMs, firstMs, secondMs);
  const transitionLoading = previewKind === 'transition' && previewLoading;
  const transitionPlaying = previewKind === 'transition' && previewPlaying;
  const resultLoading = previewKind === 'result' && previewLoading;
  const resultPlaying = previewKind === 'result' && previewPlaying;
  const playbackResultCursorMs =
    selectionPlaybackPositionMs === null
      ? null
      : previewKind === 'result'
        ? clampComparisonTime(selectionPlaybackPositionMs, resultDurationMs)
        : previewKind === 'transition'
          ? clampComparisonTime(
              Math.max(0, firstMs - COMPARISON_PREVIEW_CONTEXT_MS) + selectionPlaybackPositionMs,
              resultDurationMs,
            )
          : null;
  const displayedResultCursorMs =
    playbackResultCursorMs !== null && !resultScrubbingActive
      ? playbackResultCursorMs
      : resultCursorMs;

  const changeFirstMs = (value: number) => {
    const next = clamp(Math.round(value), 100, Math.max(100, secondMs - 1));
    setFirstMs(next);
    setResultCursorMs(Math.max(0, next - 3_000));
  };
  const changeSecondMs = (value: number) => {
    const next = clamp(
      Math.round(value),
      Math.min(source.durationMs - 100, firstMs + 1),
      source.durationMs - 100,
    );
    setSecondMs(next);
    setResultCursorMs(Math.max(0, firstMs - 3_000));
  };

  const restore = () => {
    if (!bookmark || controlsDisabled) return;
    onInteractionStart();
    setFirstMs(bookmark.firstMs);
    setSecondMs(bookmark.secondMs);
    setResultCursorMs(Math.max(0, bookmark.firstMs - 3_000));
  };
  const save = async () => {
    if (controlsDisabled || !currentPointsValid) return;
    setSaving(true);
    try {
      await onSet(firstMs, secondMs);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={controlsDisabled ? undefined : onClose}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog} testID="source-comparison-dialog">
          <View style={styles.headingRow}>
            <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
              {source.displayName}
            </Text>
            <Pressable
              accessibilityLabel="Close comparison"
              accessibilityRole="button"
              disabled={controlsDisabled}
              onPress={onClose}
              style={styles.iconButton}
            >
              <CloseIcon />
            </Pressable>
          </View>
          {operationError ? (
            <ErrorBanner
              message={operationError}
              {...(onDismissError ? { onDismiss: onDismissError } : {})}
            />
          ) : null}
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <SourceOverview
              centerMs={firstMs}
              disabled={controlsDisabled}
              durationMs={source.durationMs}
              label="First source position"
              onChange={changeFirstMs}
              onInteractionStart={onInteractionStart}
              visibleSpanMs={visibleSpanMs}
              waveform={waveform}
            />
            <View style={styles.localPair}>
              <LocalWaveform
                centerMs={firstMs}
                disabled={controlsDisabled}
                durationMs={source.durationMs}
                label="Adjust first comparison point"
                onChange={changeFirstMs}
                onInteractionStart={onInteractionStart}
                testID="comparison-first-waveform"
                visibleSpanMs={visibleSpanMs}
                waveform={waveform}
              />
              <LocalWaveform
                centerMs={secondMs}
                disabled={controlsDisabled}
                durationMs={source.durationMs}
                label="Adjust second comparison point"
                onChange={changeSecondMs}
                onInteractionStart={onInteractionStart}
                testID="comparison-second-waveform"
                visibleSpanMs={visibleSpanMs}
                waveform={waveform}
              />
              <View
                pointerEvents="none"
                style={styles.fixedPlayhead}
                testID="comparison-playhead"
              />
            </View>
            <SourceOverview
              centerMs={secondMs}
              disabled={controlsDisabled}
              durationMs={source.durationMs}
              label="Second source position"
              onChange={changeSecondMs}
              onInteractionStart={onInteractionStart}
              visibleSpanMs={visibleSpanMs}
              waveform={waveform}
            />
            <View style={styles.timeRow}>
              <Text style={styles.time}>{formatTimelineTime(firstMs)}</Text>
              <Pressable
                accessibilityLabel={transitionPlaying ? 'Pause comparison' : 'Preview comparison'}
                accessibilityRole="button"
                accessibilityState={{
                  busy: transitionLoading,
                  disabled: controlsDisabled || !currentPointsValid,
                }}
                disabled={controlsDisabled || !currentPointsValid}
                onPress={() => onPreview(firstMs, secondMs)}
                style={styles.previewButton}
                testID="comparison-transition-play"
              >
                {transitionLoading ? (
                  <ActivityIndicator color={colors.textPrimary} size="small" />
                ) : (
                  <ComparisonPreviewIcon pause={transitionPlaying} />
                )}
              </Pressable>
              <Text style={styles.time}>{formatTimelineTime(secondMs)}</Text>
            </View>
            <SpanSlider
              disabled={controlsDisabled}
              durationMs={source.durationMs}
              onChange={setVisibleSpanMs}
              onInteractionStart={onInteractionStart}
              value={visibleSpanMs}
            />
            <ComparisonResultWaveform
              cursorMs={displayedResultCursorMs}
              disabled={controlsDisabled || !currentPointsValid}
              durationMs={source.durationMs}
              firstMs={firstMs}
              loading={resultLoading}
              onCursorChange={setResultCursorMs}
              onPreview={() => onResultPreview(firstMs, secondMs, displayedResultCursorMs)}
              onScrubEnd={(positionMs) => {
                setResultScrubbingActive(false);
                onResultScrubEnd(positionMs);
              }}
              onScrubStart={() => {
                setResultScrubbingActive(true);
                onResultScrubStart();
              }}
              playing={resultPlaying}
              secondMs={secondMs}
              waveform={waveform}
            />
            <View style={styles.recordActions}>
              <Pressable
                accessibilityLabel="Set comparison points"
                accessibilityRole="button"
                accessibilityState={{ disabled: controlsDisabled || !currentPointsValid }}
                disabled={controlsDisabled || !currentPointsValid}
                onPress={() => void save()}
                style={[
                  styles.textAction,
                  (controlsDisabled || !currentPointsValid) && styles.disabled,
                ]}
              >
                <Text style={styles.textActionLabel}>Set</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Restore saved comparison points"
                accessibilityRole="button"
                accessibilityState={{ disabled: !bookmark || controlsDisabled }}
                disabled={!bookmark || controlsDisabled}
                onPress={restore}
                style={[styles.textAction, (!bookmark || controlsDisabled) && styles.disabled]}
              >
                <Text style={styles.textActionLabel}>Restore</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Add comparison clips"
                accessibilityRole="button"
                accessibilityState={{ disabled: !bookmark || controlsDisabled }}
                disabled={!bookmark || controlsDisabled}
                onPress={() => bookmark && onAddClips(bookmark)}
                style={[
                  styles.textAction,
                  styles.primaryAction,
                  (!bookmark || controlsDisabled) && styles.disabled,
                ]}
              >
                <Text style={styles.textActionLabel}>Add Clips</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.modalBackdrop,
    padding: spacing.sm,
  },
  dialog: {
    ...layout.card,
    width: '100%',
    maxWidth: 560,
    maxHeight: '96%',
    padding: spacing.sm,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.screenTitle, flex: 1 },
  iconButton: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { gap: spacing.xs, paddingBottom: spacing.xxs },
  overview: {
    height: minimumTouchTarget,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    justifyContent: 'center',
  },
  localPair: { position: 'relative', gap: spacing.xxs },
  localWaveform: {
    height: LOCAL_WAVEFORM_HEIGHT,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
  },
  fixedPlayhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.error,
  },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  slider: { flex: 1, height: minimumTouchTarget, justifyContent: 'center' },
  spanValue: {
    ...typography.label,
    width: 36,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  sliderTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  sliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.focus,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  time: { ...typography.label, flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
  previewButton: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.soft,
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  resultControl: { width: 88, alignItems: 'center', gap: spacing.xxs },
  resultWaveform: {
    flex: 1,
    height: RESULT_WAVEFORM_HEIGHT,
    overflow: 'hidden',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
  },
  resultPlayButton: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.soft,
  },
  resultSourceTime: {
    ...typography.caption,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  recordActions: { flexDirection: 'row', gap: spacing.xs },
  textAction: {
    flex: 1,
    minHeight: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  primaryAction: { backgroundColor: colors.accent },
  textActionLabel: { ...typography.label },
  disabled: { opacity: 0.5 },
});
