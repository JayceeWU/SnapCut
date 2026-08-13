import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, copy, layout, spacing, typography } from '@/constants';

import { AppButton } from './AppButton';

interface ConfirmDeleteModalProps {
  visible: boolean;
  projectName: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({
  visible,
  projectName,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDeleteModalProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel={copy.deleteDialog.cancelAction}
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.deleteDialog.title}
          </Text>
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
