import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, copy, layout, minimumTouchTarget, spacing, typography } from '@/constants';

interface CorruptProjectCardProps {
  projectId: string;
  onDelete: () => void;
}

export function CorruptProjectCard({ projectId, onDelete }: CorruptProjectCardProps) {
  return (
    <View style={styles.card} testID={`corrupt-project-card-${projectId}`}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          {copy.projects.corruptTitle}
        </Text>
        <Text style={styles.message}>{copy.projects.corruptMessage}</Text>
      </View>
      <Pressable
        accessibilityHint={copy.projects.corruptDeleteHint}
        accessibilityRole="button"
        onPress={onDelete}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionLabel}>{copy.projects.deleteAction}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...layout.card,
    borderColor: colors.error,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  content: {
    padding: spacing.md,
  },
  title: {
    ...typography.cardTitle,
    color: colors.error,
  },
  message: {
    ...typography.bodySecondary,
    marginTop: spacing.xs,
  },
  action: {
    minHeight: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: {
    ...typography.label,
    color: colors.error,
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
});
