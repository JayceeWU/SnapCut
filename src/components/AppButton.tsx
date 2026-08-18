import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, minimumTouchTarget, radii, spacing, typography } from '@/constants';

type AppButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface AppButtonProps {
  label: string;
  onPress: () => void;
  variant?: AppButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
  fullWidth?: boolean;
}

const backgrounds: Record<AppButtonVariant, string> = {
  primary: colors.accent,
  secondary: colors.soft,
  ghost: colors.transparent,
  danger: colors.error,
};

const pressedBackgrounds: Record<AppButtonVariant, string> = {
  primary: colors.accentPressed,
  secondary: colors.accentTranslucent,
  ghost: colors.accentTranslucent,
  danger: colors.accentPressed,
};

const foregrounds: Record<AppButtonVariant, string> = {
  primary: colors.background,
  secondary: colors.textPrimary,
  ghost: colors.focus,
  danger: colors.background,
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
  testID,
  fullWidth = false,
}: AppButtonProps) {
  const unavailable = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      testID={testID}
      style={({ pressed }): StyleProp<ViewStyle> => [
        styles.base,
        variant === 'secondary' && styles.outlined,
        fullWidth && styles.fullWidth,
        { backgroundColor: pressed ? pressedBackgrounds[variant] : backgrounds[variant] },
        unavailable && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.disabledText} />
      ) : (
        <Text
          style={[
            styles.label,
            { color: foregrounds[variant] },
            unavailable && styles.disabledLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minimumTouchTarget,
    minWidth: minimumTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlined: {
    borderColor: colors.border,
    borderWidth: 1,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    backgroundColor: colors.disabledSurface,
    borderColor: colors.disabledSurface,
  },
  label: {
    ...typography.label,
    textAlign: 'center',
  },
  disabledLabel: {
    color: colors.disabledText,
  },
});
