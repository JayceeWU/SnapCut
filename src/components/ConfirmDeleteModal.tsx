import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, copy, layout, spacing, typography } from '@/constants';

import { AppButton } from './AppButton';
import { ErrorBanner } from './ErrorBanner';

interface ConfirmDeleteModalProps {
  visible: boolean;
  projectName: string;
  busy?: boolean;
  operationError?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onDismissError?: (() => void) | undefined;
}

export function ConfirmDeleteModal({
  visible,
  projectName,
  busy = false,
  operationError = null,
  onCancel,
  onConfirm,
  onDismissError,
}: ConfirmDeleteModalProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={busy ? undefined : onCancel}
      statusBarTranslucent
      testID="confirm-delete-modal"
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel={copy.deleteDialog.cancelAction}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
          testID="confirm-delete-backdrop"
        />
        <View accessibilityViewIsModal style={styles.dialog} testID="confirm-delete-dialog">
          <Text accessibilityRole="header" style={styles.title}>
            {copy.deleteDialog.title}
          </Text>
          {operationError ? (
            <ErrorBanner
              message={operationError}
              {...(onDismissError ? { onDismiss: onDismissError } : {})}
            />
          ) : null}
          <Text style={styles.message}>{copy.deleteDialog.message(projectName)}</Text>
          <Text style={styles.warning}>{copy.deleteDialog.warning}</Text>
          <View style={styles.actions}>
            <AppButton
              disabled={busy}
              label={copy.deleteDialog.cancelAction}
              onPress={onCancel}
              variant="ghost"
            />
            <AppButton
              label={copy.deleteDialog.confirmAction}
              loading={busy}
              onPress={onConfirm}
              variant="danger"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.accentTranslucent,
  },
  dialog: {
    ...layout.card,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: spacing.lg,
  },
  title: {
    ...typography.screenTitle,
    color: colors.error,
    marginBottom: spacing.md,
  },
  message: {
    ...typography.body,
  },
  warning: {
    ...typography.bodySecondary,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
});
