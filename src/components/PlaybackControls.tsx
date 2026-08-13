import { StyleSheet, Text, View } from 'react-native';

import { copy, formatDuration, spacing, typography } from '@/constants';
import type { PreviewMode } from '@/stores';

import { AppButton } from './AppButton';

interface PlaybackControlsProps {
  mode: PreviewMode;
  activeMode: PreviewMode | null;
  available: boolean;
  disabled: boolean;
  loaded: boolean;
  loading: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  unavailableHint: string;
  onToggle: () => void;
  onSeek: (positionMs: number) => void;
}

export function PlaybackControls({
  mode,
  activeMode,
  available,
  disabled,
  loaded,
  loading,
  playing,
  positionMs,
  durationMs,
  unavailableHint,
  onToggle,
  onSeek,
}: PlaybackControlsProps) {
  const active = mode === activeMode;
  const activeLoading = active && loading;
  const activePlaying = active && playing;
  const toggleLabel = activeLoading
    ? copy.editor.previewLoading
    : mode === 'selection'
      ? activePlaying
        ? copy.editor.selectionPauseAction
        : copy.editor.selectionPlayAction
      : activePlaying
        ? copy.editor.compositionPauseAction
        : copy.editor.compositionPlayAction;
  const seekDisabled = !active || !loaded || activeLoading;

  return (
    <View style={styles.container}>
      <AppButton
        {...(!available ? { accessibilityHint: unavailableHint } : {})}
        disabled={disabled || !available || activeLoading}
        label={toggleLabel}
        onPress={onToggle}
        variant="secondary"
      />
      {active && loaded ? (
        <>
          <AppButton
            disabled={seekDisabled || positionMs <= 0}
            label={copy.editor.seekBackward}
            onPress={() => onSeek(positionMs - 5_000)}
            variant="ghost"
          />
          <Text accessibilityLiveRegion="polite" style={styles.position}>
            {copy.editor.playbackPosition(formatDuration(positionMs), formatDuration(durationMs))}
          </Text>
          <AppButton
            disabled={seekDisabled || positionMs >= durationMs}
            label={copy.editor.seekForward}
            onPress={() => onSeek(positionMs + 5_000)}
            variant="ghost"
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  position: {
    ...typography.label,
    minWidth: 92,
    textAlign: 'center',
  },
});
