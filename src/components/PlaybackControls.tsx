import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, copy, minimumTouchTarget, radii, spacing, typography } from '@/constants';
import { formatTimelineTime } from '@/utils/time';

interface PlaybackControlsProps {
  available: boolean;
  compositionAvailable: boolean;
  disabled: boolean;
  loading: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  canUndo: boolean;
  canRedo: boolean;
  unavailableHint: string;
  onPlay: () => void;
  onPause: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

type TransportIconName = 'play' | 'pause' | 'undo' | 'redo';

interface TransportButtonProps {
  accessibilityHint?: string | undefined;
  accessibilityLabel: string;
  busy?: boolean;
  disabled: boolean;
  icon: TransportIconName;
  emphasized?: boolean;
  onPress: () => void;
  testID: string;
}

function TransportIcon({ icon, color }: { icon: TransportIconName; color: string }) {
  if (icon === 'play') {
    return (
      <Svg height={26} viewBox="0 0 24 24" width={26}>
        <Path d="M7 4v16l12-8L7 4Z" fill={color} />
      </Svg>
    );
  }
  if (icon === 'pause') {
    return (
      <Svg height={26} viewBox="0 0 24 24" width={26}>
        <Path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" fill={color} />
      </Svg>
    );
  }
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d={
          icon === 'undo'
            ? 'M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6'
            : 'm15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6'
        }
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

function TransportButton({
  accessibilityHint,
  accessibilityLabel,
  busy = false,
  disabled,
  icon,
  emphasized = false,
  onPress,
  testID,
}: TransportButtonProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        emphasized && styles.playButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}
    >
      <View accessibilityElementsHidden style={styles.icon}>
        <TransportIcon icon={icon} color={emphasized ? colors.background : colors.textPrimary} />
      </View>
    </Pressable>
  );
}

export function PlaybackControls({
  available,
  compositionAvailable,
  disabled,
  loading,
  playing,
  positionMs,
  durationMs,
  canUndo,
  canRedo,
  unavailableHint,
  onPlay,
  onPause,
  onUndo,
  onRedo,
}: PlaybackControlsProps) {
  const pauseIntent = playing || loading;
  const playDisabled = disabled || !available || (!compositionAvailable && !pauseIntent);
  const toggleLabel = pauseIntent
    ? copy.editor.compositionPauseAction
    : copy.editor.compositionPlayAction;

  return (
    <View style={styles.container} testID="composition-transport">
      <Text numberOfLines={1} style={styles.position} testID="transport-position">
        {formatTimelineTime(Math.max(0, Math.round(positionMs)))} /{' '}
        {formatTimelineTime(Math.max(0, Math.round(durationMs)))}
      </Text>
      <View style={styles.actions}>
        <TransportButton
          accessibilityHint={!available ? unavailableHint : undefined}
          accessibilityLabel={toggleLabel}
          busy={loading}
          disabled={playDisabled}
          emphasized
          icon={pauseIntent ? 'pause' : 'play'}
          onPress={pauseIntent ? onPause : onPlay}
          testID="transport-play-pause"
        />
        <TransportButton
          accessibilityLabel={copy.editor.undoAction}
          disabled={disabled || !canUndo}
          icon="undo"
          onPress={onUndo}
          testID="transport-undo"
        />
        <TransportButton
          accessibilityLabel={copy.editor.redoAction}
          disabled={disabled || !canRedo}
          icon="redo"
          onPress={onRedo}
          testID="transport-redo"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  position: {
    ...typography.label,
    flexShrink: 1,
    minWidth: 104,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  button: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.soft,
  },
  playButton: {
    backgroundColor: colors.accent,
  },
  icon: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    backgroundColor: colors.disabledSurface,
    opacity: 0.72,
  },
  pressed: {
    backgroundColor: colors.accentPressed,
  },
});
