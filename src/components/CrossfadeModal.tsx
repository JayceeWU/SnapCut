import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, minimumTouchTarget, radii, spacing, typography } from '@/constants';
import type { CrossfadeDurationMs } from '@/domain';

import { AppButton } from './AppButton';
import { ErrorBanner } from './ErrorBanner';

interface CrossfadeModalProps {
  availableDurationsMs: readonly CrossfadeDurationMs[];
  busy: boolean;
  initialDurationMs?: CrossfadeDurationMs | undefined;
  operationError?: string | null;
  visible: boolean;
  onCancel: () => void;
  onDelete?: (() => void) | undefined;
  onDismissError?: (() => void) | undefined;
  onSave: (durationMs: CrossfadeDurationMs) => void;
}

function VisibleCrossfadeModal({
  availableDurationsMs,
  busy,
  initialDurationMs,
  operationError = null,
  onCancel,
  onDelete,
  onDismissError,
  onSave,
}: CrossfadeModalProps) {
  const [durationMs, setDurationMs] = useState<CrossfadeDurationMs>(
    initialDurationMs && availableDurationsMs.includes(initialDurationMs)
      ? initialDurationMs
      : availableDurationsMs[0]!,
  );
  return (
    <Modal
      animationType="fade"
      onRequestClose={busy ? undefined : onCancel}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Cancel crossfade edit"
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
          testID="crossfade-backdrop"
        />
        <View accessibilityViewIsModal style={styles.dialog} testID="crossfade-dialog">
          <Text accessibilityRole="header" style={styles.title}>
            {onDelete ? 'Edit Crossfade' : 'Add Crossfade'}
          </Text>
          {operationError ? (
            <ErrorBanner
              message={operationError}
              {...(onDismissError ? { onDismiss: onDismissError } : {})}
            />
          ) : null}
          <View style={styles.options}>
            {([1_000, 2_000, 4_000, 6_000, 8_000] as const).map((candidate) => {
              const available = availableDurationsMs.includes(candidate);
              const selected = candidate === durationMs;
              return (
                <Pressable
                  accessibilityLabel={`${candidate / 1_000} second crossfade`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: busy || !available }}
                  disabled={busy || !available}
                  key={candidate}
                  onPress={() => setDurationMs(candidate)}
                  style={({ pressed }) => [
                    styles.option,
                    selected && styles.selected,
                    !available && styles.disabled,
                    pressed && available && styles.pressed,
                  ]}
                >
                  <Text style={styles.optionText}>{candidate / 1_000}s</Text>
                </Pressable>
              );
            })}
          </View>
          {availableDurationsMs.length < 5 ? (
            <Text accessibilityLiveRegion="polite" style={styles.reason}>
              Longer choices need more unused source audio around this clip boundary.
            </Text>
          ) : null}
          <View style={styles.actions}>
            {onDelete ? (
              <AppButton disabled={busy} label="Delete" onPress={onDelete} variant="danger" />
            ) : (
              <View />
            )}
            <View style={styles.primaryActions}>
              <AppButton disabled={busy} label="Cancel" onPress={onCancel} variant="ghost" />
              <AppButton loading={busy} label="Save" onPress={() => onSave(durationMs)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function CrossfadeModal(props: CrossfadeModalProps) {
  if (!props.visible || props.availableDurationsMs.length === 0) return null;
  return (
    <VisibleCrossfadeModal
      key={`${props.initialDurationMs ?? 'new'}:${props.availableDurationsMs.join('-')}`}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.modalBackdrop,
  },
  dialog: { ...layout.card, width: '100%', maxWidth: 420, padding: spacing.lg, gap: spacing.md },
  title: { ...typography.screenTitle },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  option: {
    minWidth: minimumTouchTarget,
    minHeight: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
  },
  selected: { borderColor: colors.focus, backgroundColor: colors.accentTranslucent },
  optionText: { ...typography.label },
  reason: { ...typography.caption, color: colors.textSecondary },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  primaryActions: { flexDirection: 'row', gap: spacing.xs },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
