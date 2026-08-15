import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, layout, radii, spacing, typography } from '@/constants';
import type { SnapCutClip, SnapCutSource } from '@/domain';
import { formatTimelineTime, parseExactTime } from '@/utils/time';

import { AppButton } from './AppButton';
import { ErrorBanner } from './ErrorBanner';

export interface ClipRangeDraft {
  sourceId: string;
  startMs: number;
  endMs: number;
}

export interface ClipRangeValidationResult {
  value: ClipRangeDraft | null;
  message: string | null;
}

export function validateClipRangeDraft(
  sourceId: string,
  startInput: string,
  endInput: string,
  sources: readonly SnapCutSource[],
): ClipRangeValidationResult {
  const source = sources.find(({ id }) => id === sourceId);
  if (!source) return { value: null, message: 'Choose a source.' };

  let startMs: number;
  let endMs: number;
  try {
    startMs = parseExactTime(startInput);
    endMs = parseExactTime(endInput);
  } catch {
    return {
      value: null,
      message: 'Use SS.mmm, M:SS.mmm, or H:MM:SS.mmm.',
    };
  }
  if (startMs >= endMs) {
    return { value: null, message: 'End must be later than start.' };
  }
  if (endMs - startMs < 100) {
    return { value: null, message: 'Choose at least 0.100 seconds.' };
  }
  if (endMs > source.durationMs) {
    return {
      value: null,
      message: `End cannot be later than ${formatTimelineTime(source.durationMs)}.`,
    };
  }
  return { value: { sourceId, startMs, endMs }, message: null };
}

interface ClipEditModalProps {
  visible: boolean;
  sources: readonly SnapCutSource[];
  clip?: SnapCutClip | null;
  initialSourceId?: string | null;
  busy?: boolean;
  operationError?: string | null;
  onCancel: () => void;
  onDelete?: (() => void) | undefined;
  onDismissError?: (() => void) | undefined;
  onSave: (draft: ClipRangeDraft) => void;
}

function initialSource(
  sources: readonly SnapCutSource[],
  clip: SnapCutClip | null | undefined,
  initialSourceId: string | null | undefined,
): SnapCutSource | null {
  const sourceId = clip?.sourceId ?? initialSourceId;
  return sources.find(({ id }) => id === sourceId) ?? sources[0] ?? null;
}

function VisibleClipEditModal({
  visible,
  sources,
  clip = null,
  initialSourceId = null,
  busy = false,
  operationError = null,
  onCancel,
  onDelete,
  onDismissError,
  onSave,
}: ClipEditModalProps) {
  const firstSource = useMemo(
    () => initialSource(sources, clip, initialSourceId),
    [clip, initialSourceId, sources],
  );
  const [sourceId, setSourceId] = useState(firstSource?.id ?? '');
  const [startInput, setStartInput] = useState(formatTimelineTime(clip?.startMs ?? 0));
  const [endInput, setEndInput] = useState(
    formatTimelineTime(clip?.endMs ?? firstSource?.durationMs ?? 0),
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const chooseSource = (source: SnapCutSource) => {
    setSourceId(source.id);
    setStartInput(formatTimelineTime(0));
    setEndInput(formatTimelineTime(source.durationMs));
    setValidationMessage(null);
  };

  const submit = () => {
    const result = validateClipRangeDraft(sourceId, startInput, endInput, sources);
    if (!result.value) {
      setValidationMessage(result.message);
      return;
    }
    onSave(result.value);
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
          accessibilityLabel="Cancel clip edit"
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
          testID="clip-editor-backdrop"
        />
        <View accessibilityViewIsModal style={styles.dialog} testID="clip-editor-dialog">
          <Text accessibilityRole="header" style={styles.title}>
            {clip ? 'Edit Clip' : 'Add Clip'}
          </Text>
          {operationError ? (
            <ErrorBanner
              message={operationError}
              {...(onDismissError ? { onDismiss: onDismissError } : {})}
            />
          ) : null}

          <Text style={styles.label}>Source</Text>
          <ScrollView
            contentContainerStyle={styles.sourceList}
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
          >
            {sources.map((source) => {
              const selected = source.id === sourceId;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: busy }}
                  disabled={busy}
                  key={source.id}
                  onPress={() => chooseSource(source)}
                  style={({ pressed }) => [
                    styles.sourceChoice,
                    selected && styles.selectedSource,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.sourceChoiceName}>
                    {source.displayName}
                  </Text>
                  <Text style={styles.sourceDuration}>{formatTimelineTime(source.durationMs)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.label}>Start</Text>
              <TextInput
                accessibilityLabel="Clip start time"
                autoCorrect={false}
                editable={!busy}
                onChangeText={(value) => {
                  setStartInput(value);
                  setValidationMessage(null);
                }}
                placeholder="0:00.000"
                placeholderTextColor={colors.disabledText}
                selectTextOnFocus
                selectionColor={colors.focus}
                style={[styles.input, validationMessage && styles.inputError]}
                testID="clip-start-input"
                value={startInput}
              />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.label}>End</Text>
              <TextInput
                accessibilityLabel="Clip end time"
                autoCorrect={false}
                editable={!busy}
                onChangeText={(value) => {
                  setEndInput(value);
                  setValidationMessage(null);
                }}
                onSubmitEditing={submit}
                placeholder="0:00.000"
                placeholderTextColor={colors.disabledText}
                returnKeyType="done"
                selectTextOnFocus
                selectionColor={colors.focus}
                style={[styles.input, validationMessage && styles.inputError]}
                testID="clip-end-input"
                value={endInput}
              />
            </View>
          </View>
          <Text style={styles.inputHint}>SS.mmm · M:SS.mmm · H:MM:SS.mmm</Text>
          {validationMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.validation}>
              {validationMessage}
            </Text>
          ) : null}

          <View style={styles.actions}>
            {clip && onDelete ? (
              <AppButton disabled={busy} label="Delete" onPress={onDelete} variant="danger" />
            ) : (
              <View />
            )}
            <View style={styles.primaryActions}>
              <AppButton disabled={busy} label="Cancel" onPress={onCancel} variant="ghost" />
              <AppButton loading={busy} label="Save" onPress={submit} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ClipEditModal(props: ClipEditModalProps) {
  if (!props.visible) return null;
  const { clip, initialSourceId } = props;
  const editorKey = `${clip?.id ?? 'new'}:${clip?.sourceId ?? initialSourceId ?? ''}:${clip?.startMs ?? 0}:${clip?.endMs ?? 0}`;
  return <VisibleClipEditModal key={editorKey} {...props} />;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.modalBackdrop,
  },
  dialog: {
    ...layout.card,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    padding: spacing.md,
  },
  title: {
    ...typography.screenTitle,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.label,
    marginBottom: spacing.xs,
  },
  sourceList: {
    gap: spacing.xs,
    paddingBottom: spacing.md,
  },
  sourceChoice: {
    width: 140,
    minHeight: 60,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
  },
  selectedSource: {
    borderColor: colors.focus,
    backgroundColor: colors.accentTranslucent,
  },
  sourceChoiceName: {
    ...typography.label,
  },
  sourceDuration: {
    ...typography.caption,
    marginTop: spacing.xxs,
    fontVariant: ['tabular-nums'],
  },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timeField: {
    flex: 1,
    minWidth: 0,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: spacing.sm,
  },
  inputError: {
    borderColor: colors.error,
  },
  inputHint: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  validation: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  primaryActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.78,
  },
});
