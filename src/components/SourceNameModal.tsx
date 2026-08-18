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

import { colors, layout, radii, spacing, typography } from '@/constants';
import { MAX_SOURCE_NAME_CODE_POINTS } from '@/domain';

import { AppButton } from './AppButton';
import { ErrorBanner } from './ErrorBanner';

interface SourceNameModalProps {
  visible: boolean;
  initialName: string;
  busy?: boolean;
  operationError?: string | null;
  title?: string;
  onCancel: () => void;
  onDismissError?: (() => void) | undefined;
  onSubmit: (name: string) => void;
}

function VisibleSourceNameModal({
  visible,
  initialName,
  busy = false,
  operationError = null,
  title = 'Name Source',
  onCancel,
  onDismissError,
  onSubmit,
}: SourceNameModalProps) {
  const [name, setName] = useState(initialName);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const submit = () => {
    const normalized = name.trim();
    if (!normalized) {
      setValidationMessage('Enter a source name.');
      return;
    }
    if ([...normalized].length > MAX_SOURCE_NAME_CODE_POINTS) {
      setValidationMessage(`Use ${MAX_SOURCE_NAME_CODE_POINTS} characters or fewer.`);
      return;
    }
    onSubmit(normalized);
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={busy ? undefined : onCancel}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable
          accessible={false}
          disabled={busy}
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.dialog} testID="source-name-dialog">
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {operationError ? (
            <ErrorBanner
              message={operationError}
              {...(onDismissError ? { onDismiss: onDismissError } : {})}
            />
          ) : null}
          <Text style={styles.label}>Source name</Text>
          <TextInput
            accessibilityLabel="Source name"
            autoCapitalize="sentences"
            autoCorrect={false}
            autoFocus
            editable={!busy}
            onChangeText={(value) => {
              setName([...value].slice(0, MAX_SOURCE_NAME_CODE_POINTS).join(''));
              setValidationMessage(null);
            }}
            onSubmitEditing={submit}
            placeholder="Source 1"
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
            <AppButton disabled={busy} label="Cancel" onPress={onCancel} variant="ghost" />
            <AppButton loading={busy} label="Save" onPress={submit} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SourceNameModal(props: SourceNameModalProps) {
  if (!props.visible) return null;
  return (
    <VisibleSourceNameModal
      key={`${props.title ?? 'Name Source'}:${props.initialName}`}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.modalBackdrop,
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
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
});
