import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, copy, layout, radii, spacing, typography } from '@/constants';

import { AppButton } from './AppButton';

interface ProjectNameModalProps {
  visible: boolean;
  initialName?: string | undefined;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

const maximumNameLength = 80;

export function ProjectNameModal({
  visible,
  initialName = '',
  busy = false,
  onCancel,
  onSubmit,
}: ProjectNameModalProps) {
  const [name, setName] = useState(initialName);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const resetForm = () => {
    setName(initialName);
    setValidationMessage(null);
  };

  const submit = () => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setValidationMessage(copy.nameDialog.requiredError);
      return;
    }
    if (normalizedName.length > maximumNameLength) {
      setValidationMessage(copy.nameDialog.tooLongError);
      return;
    }
    onSubmit(normalizedName);
  };

  return (
    <Modal
      animationType="fade"
      onShow={resetForm}
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable
          accessibilityLabel={copy.nameDialog.cancelAction}
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.nameDialog.renameTitle}
          </Text>
          <Text style={styles.label}>{copy.nameDialog.fieldLabel}</Text>
          <TextInput
            accessibilityLabel={copy.nameDialog.fieldLabel}
            autoCapitalize="sentences"
            autoCorrect={false}
            autoFocus
            editable={!busy}
            maxLength={maximumNameLength + 1}
            onChangeText={(value) => {
              setName(value);
              if (validationMessage) setValidationMessage(null);
            }}
            onSubmitEditing={submit}
            placeholder={copy.nameDialog.placeholder}
            placeholderTextColor={colors.disabledText}
            returnKeyType="done"
            selectionColor={colors.focus}
            style={[styles.input, validationMessage && styles.inputError]}
            value={name}
          />
          {validationMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.validation}>
              {validationMessage}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <View style={styles.actionItem}>
              <AppButton
                disabled={busy}
                label={copy.nameDialog.cancelAction}
                onPress={onCancel}
                variant="ghost"
              />
            </View>
            <View style={styles.actionItem}>
              <AppButton loading={busy} label={copy.nameDialog.saveAction} onPress={submit} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.label,
    marginBottom: spacing.xs,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    fontSize: 16,
    paddingHorizontal: spacing.md,
  },
  inputError: {
    borderColor: colors.error,
  },
  validation: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  actionItem: {
    minWidth: 96,
  },
});
