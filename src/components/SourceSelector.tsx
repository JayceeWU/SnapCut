import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors, copy, minimumTouchTarget, radii, spacing, typography } from '@/constants';
import type { SnapCutSource } from '@/domain';

interface SourceSelectorProps {
  sources: readonly SnapCutSource[];
  selectedSourceId: string | null;
  onSelect: (source: SnapCutSource) => void;
}

export function SourceSelector({ sources, selectedSourceId, onSelect }: SourceSelectorProps) {
  return (
    <ScrollView
      accessibilityLabel={copy.editor.sourceSelectorLabel}
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {sources.map((source) => {
        const selected = source.id === selectedSourceId;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={source.id}
            onPress={() => onSelect(source)}
            style={({ pressed }) => [
              styles.source,
              selected && styles.selectedSource,
              pressed && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={[styles.label, selected && styles.selectedLabel]}>
              {source.displayName}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  source: {
    minHeight: minimumTouchTarget,
    maxWidth: 240,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  selectedSource: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTranslucent,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  selectedLabel: {
    color: colors.textPrimary,
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
});
