import { StyleSheet, Text, View } from 'react-native';

import { colors, layout, spacing, typography } from '@/constants';

import { AppButton } from './AppButton';

interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  compact?: boolean;
  testID?: string;
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  actionDisabled = false,
  actionLoading = false,
  compact = false,
  testID,
}: EmptyStateProps) {
  return (
    <View style={[styles.container, compact && styles.compact]} testID={testID}>
      <View accessibilityElementsHidden style={styles.mark}>
        <View style={styles.markInner} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <AppButton
            disabled={actionDisabled}
            label={actionLabel}
            loading={actionLoading}
            onPress={onAction}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...layout.card,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  compact: {
    paddingVertical: spacing.lg,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentTranslucent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  markInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  title: {
    ...typography.sectionTitle,
    textAlign: 'center',
  },
  message: {
    ...typography.bodySecondary,
    textAlign: 'center',
    maxWidth: 360,
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.lg,
  },
});
