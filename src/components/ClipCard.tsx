import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SnapCutClip, SnapCutSource } from '@/domain/types';
import {
  colors,
  copy,
  formatDuration,
  layout,
  minimumTouchTarget,
  spacing,
  typography,
} from '@/constants';

interface ClipCardProps {
  clip: SnapCutClip;
  source: SnapCutSource | undefined;
  index: number;
  clipCount: number;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

interface CompactActionProps {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: (() => void) | undefined;
}

function CompactAction({ label, disabled = false, danger = false, onPress }: CompactActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || !onPress }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Text
        style={[
          styles.actionLabel,
          danger && styles.dangerLabel,
          (disabled || !onPress) && styles.disabledLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ClipCard({
  clip,
  source,
  index,
  clipCount,
  onMoveEarlier,
  onMoveLater,
  onEdit,
  onDuplicate,
  onDelete,
}: ClipCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <View style={styles.orderBadge}>
          <Text style={styles.order}>{index + 1}</Text>
        </View>
        <View style={styles.details}>
          <Text numberOfLines={1} style={styles.sourceName}>
            {source?.displayName ?? copy.clips.unknownSource}
          </Text>
          <Text style={styles.range}>
            {copy.clips.range(formatDuration(clip.startMs), formatDuration(clip.endMs))}
          </Text>
          <Text style={styles.duration}>
            {copy.clips.duration(formatDuration(clip.endMs - clip.startMs))}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <CompactAction
          disabled={index === 0}
          label={copy.clips.moveEarlier}
          onPress={onMoveEarlier}
        />
        <CompactAction
          disabled={index === clipCount - 1}
          label={copy.clips.moveLater}
          onPress={onMoveLater}
        />
        <CompactAction label={copy.clips.edit} onPress={onEdit} />
        <CompactAction label={copy.clips.duplicate} onPress={onDuplicate} />
        <CompactAction danger label={copy.clips.delete} onPress={onDelete} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...layout.card,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  orderBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentTranslucent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  order: {
    ...typography.label,
    color: colors.focus,
  },
  details: {
    flex: 1,
  },
  sourceName: {
    ...typography.cardTitle,
  },
  range: {
    ...typography.bodySecondary,
    color: colors.textPrimary,
    marginTop: spacing.xxs,
  },
  duration: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    minHeight: minimumTouchTarget,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionLabel: {
    ...typography.caption,
    color: colors.focus,
    fontWeight: '600',
  },
  dangerLabel: {
    color: colors.error,
  },
  disabledLabel: {
    color: colors.disabledText,
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
});
