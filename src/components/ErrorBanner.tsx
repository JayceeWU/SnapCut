import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, copy, minimumTouchTarget, radii, spacing, typography } from '@/constants';

interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onDismiss, onRetry }: ErrorBannerProps) {
  return (
    <View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      accessible
      style={styles.banner}
    >
      <View style={styles.messageColumn}>
        <Text style={styles.title}>{copy.projects.unknownError}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
      <View style={styles.actions}>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionLabel}>{copy.projects.retry}</Text>
          </Pressable>
        ) : null}
        {onDismiss ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.common.dismissError}
            onPress={onDismiss}
            hitSlop={spacing.xs}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Text accessibilityElementsHidden style={styles.closeLabel}>
              ×
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.soft,
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingLeft: spacing.md,
    marginBottom: spacing.md,
  },
  messageColumn: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.label,
    color: colors.error,
    marginBottom: spacing.xxs,
  },
  message: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  action: {
    minHeight: minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionLabel: {
    ...typography.label,
    color: colors.focus,
  },
  close: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeLabel: {
    color: colors.textSecondary,
    fontSize: 26,
    lineHeight: 28,
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
});
