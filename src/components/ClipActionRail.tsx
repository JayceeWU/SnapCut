import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { colors, minimumTouchTarget, radii, spacing, typography } from '@/constants';

import { editorWorkspaceLayout } from './editorWorkspaceLayout';

interface RailActionProps {
  label: string;
  icon: 'volume' | 'fade' | 'split' | 'delete';
  disabled?: boolean;
  danger?: boolean;
  accessibilityHint?: string;
  onPress: () => void;
  testID: string;
}

function ActionIcon({ icon, color }: { icon: RailActionProps['icon']; color: string }) {
  if (icon === 'volume') {
    return (
      <Svg height={24} viewBox="0 0 24 24" width={24}>
        <Path
          d="M4 9v6h4l5 4V5L8 9H4Z"
          fill="none"
          stroke={color}
          strokeLinejoin="round"
          strokeWidth={2}
        />
        <Path
          d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeWidth={2}
        />
      </Svg>
    );
  }
  if (icon === 'fade') {
    return (
      <Svg height={24} viewBox="0 0 24 24" width={24}>
        <Path
          d="M3 18C8 18 8 6 13 6h8M3 6c5 0 5 12 10 12h8"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeWidth={2}
        />
      </Svg>
    );
  }
  if (icon === 'split') {
    return (
      <Svg height={24} viewBox="0 0 24 24" width={24}>
        <Circle cx={7} cy={17} fill="none" r={3} stroke={color} strokeWidth={2} />
        <Circle cx={17} cy={17} fill="none" r={3} stroke={color} strokeWidth={2} />
        <Line stroke={color} strokeLinecap="round" strokeWidth={2} x1={9} x2={15} y1={15} y2={5} />
        <Line stroke={color} strokeLinecap="round" strokeWidth={2} x1={15} x2={11} y1={15} y2={9} />
      </Svg>
    );
  }
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d="M5 7h14l-1 13H6L5 7Zm3-3h8l1 3H7l1-3Z"
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <Rect fill={color} height={9} rx={1} width={2} x={9} y={9} />
      <Rect fill={color} height={9} rx={1} width={2} x={13} y={9} />
    </Svg>
  );
}

function RailAction({
  label,
  icon,
  disabled = false,
  danger = false,
  accessibilityHint,
  onPress,
  testID,
}: RailActionProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        danger && styles.dangerAction,
        disabled && styles.disabledAction,
        pressed && !disabled && styles.pressedAction,
      ]}
      testID={testID}
    >
      <View accessibilityElementsHidden style={styles.icon}>
        <ActionIcon
          color={disabled ? colors.disabledText : danger ? colors.error : colors.focus}
          icon={icon}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[styles.label, danger && styles.dangerLabel, disabled && styles.disabledLabel]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface ClipActionRailProps {
  visible: boolean;
  disabled?: boolean;
  splitEnabled: boolean;
  onVolume: () => void;
  onFade: () => void;
  onSplit: () => void;
  onDelete: () => void;
}

export function ClipActionRail({
  visible,
  disabled = false,
  splitEnabled,
  onVolume,
  onFade,
  onSplit,
  onDelete,
}: ClipActionRailProps) {
  if (!visible) return null;
  return (
    <View accessibilityLabel="Clip actions" style={styles.rail} testID="clip-action-rail">
      <RailAction
        disabled={disabled}
        icon="volume"
        label="Volume"
        onPress={onVolume}
        testID="clip-action-volume"
      />
      <RailAction
        disabled={disabled}
        icon="fade"
        label="Fade"
        onPress={onFade}
        testID="clip-action-fade"
      />
      <RailAction
        accessibilityHint={
          splitEnabled
            ? 'Splits the selected clip at the cursor.'
            : 'Move the cursor inside the clip.'
        }
        disabled={disabled || !splitEnabled}
        icon="split"
        label="Split"
        onPress={onSplit}
        testID="clip-action-split"
      />
      <RailAction
        danger
        disabled={disabled}
        icon="delete"
        label="Delete"
        onPress={onDelete}
        testID="clip-action-delete"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    height: editorWorkspaceLayout.actionRailHeight,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.xxs,
    marginTop: editorWorkspaceLayout.sectionGap,
    padding: spacing.xxs,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  action: {
    minWidth: 0,
    minHeight: minimumTouchTarget,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.sm,
  },
  dangerAction: {
    backgroundColor: colors.accentTranslucent,
  },
  disabledAction: {
    opacity: 0.42,
  },
  pressedAction: {
    backgroundColor: colors.accentTranslucent,
  },
  icon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.caption,
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },
  dangerLabel: {
    color: colors.error,
  },
  disabledLabel: {
    color: colors.disabledText,
  },
});
