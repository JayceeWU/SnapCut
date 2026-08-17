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

export interface ClipTimeParts {
  minutes: string;
  seconds: string;
  milliseconds: string;
}

function timePartsFromMilliseconds(valueMs: number): ClipTimeParts {
  const totalMinutes = Math.floor(valueMs / 60_000);
  const seconds = Math.floor(valueMs / 1_000) % 60;
  const milliseconds = valueMs % 1_000;
  return {
    minutes: String(totalMinutes),
    seconds: String(seconds).padStart(2, '0'),
    milliseconds: String(milliseconds).padStart(3, '0'),
  };
}

function parseTimeParts(parts: ClipTimeParts): number {
  const values = [parts.minutes, parts.seconds, parts.milliseconds];
  if (values.some((value) => !/^\d+$/u.test(value))) {
    throw new Error('Time parts must contain digits.');
  }

  const minutes = Number(parts.minutes);
  const seconds = Number(parts.seconds);
  const milliseconds = Number(parts.milliseconds);
  if (
    !Number.isSafeInteger(minutes) ||
    !Number.isSafeInteger(seconds) ||
    !Number.isSafeInteger(milliseconds) ||
    seconds >= 60 ||
    milliseconds >= 1_000
  ) {
    throw new Error('Time parts are outside their allowed ranges.');
  }

  const valueMs = minutes * 60_000 + seconds * 1_000 + milliseconds;
  if (!Number.isSafeInteger(valueMs)) {
    throw new Error('Time is too large.');
  }
  return valueMs;
}

function validateClipMilliseconds(
  sourceId: string,
  startMs: number,
  endMs: number,
  sources: readonly SnapCutSource[],
): ClipRangeValidationResult {
  const source = sources.find(({ id }) => id === sourceId);
  if (!source) return { value: null, message: 'Choose a source.' };
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
  return validateClipMilliseconds(sourceId, startMs, endMs, sources);
}

export function validateClipTimePartsDraft(
  sourceId: string,
  start: ClipTimeParts,
  end: ClipTimeParts,
  sources: readonly SnapCutSource[],
): ClipRangeValidationResult {
  let startMs: number;
  let endMs: number;
  try {
    startMs = parseTimeParts(start);
    endMs = parseTimeParts(end);
  } catch {
    return {
      value: null,
      message: 'Enter minutes, seconds, and milliseconds using numbers.',
    };
  }
  return validateClipMilliseconds(sourceId, startMs, endMs, sources);
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

interface TimePartsEditorProps {
  label: string;
  value: ClipTimeParts;
  busy: boolean;
  invalid: boolean;
  testIdPrefix: string;
  onChange: (value: ClipTimeParts) => void;
  onSubmitEditing?: (() => void) | undefined;
}

function digitsOnly(value: string, maxLength: number): string {
  return value.replace(/\D/gu, '').slice(0, maxLength);
}

function TimePartsEditor({
  label,
  value,
  busy,
  invalid,
  testIdPrefix,
  onChange,
  onSubmitEditing,
}: TimePartsEditorProps) {
  const parts = [
    { key: 'minutes' as const, label: 'M', accessibilityLabel: 'minutes', maxLength: 6 },
    { key: 'seconds' as const, label: 'SS', accessibilityLabel: 'seconds', maxLength: 2 },
    {
      key: 'milliseconds' as const,
      label: 'mmm',
      accessibilityLabel: 'milliseconds',
      maxLength: 3,
    },
  ];

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.timePartsRow}>
        {parts.map((part) => (
          <View key={part.key} style={styles.timePartField}>
            <Text style={styles.timePartLabel}>{part.label}</Text>
            <TextInput
              accessibilityLabel={`${label} ${part.accessibilityLabel}`}
              autoCorrect={false}
              editable={!busy}
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={part.maxLength}
              onChangeText={(input) =>
                onChange({ ...value, [part.key]: digitsOnly(input, part.maxLength) })
              }
              {...(part.key === 'milliseconds' && onSubmitEditing
                ? { onSubmitEditing, returnKeyType: 'done' as const }
                : {})}
              placeholder={part.key === 'minutes' ? '0' : part.key === 'seconds' ? '00' : '000'}
              placeholderTextColor={colors.disabledText}
              selectTextOnFocus
              selectionColor={colors.focus}
              style={[styles.input, styles.timePartInput, invalid && styles.inputError]}
              testID={`${testIdPrefix}-${part.key}-input`}
              value={value[part.key]}
            />
          </View>
        ))}
      </View>
    </View>
  );
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
  const [startInput, setStartInput] = useState(() => timePartsFromMilliseconds(clip?.startMs ?? 0));
  const [endInput, setEndInput] = useState(() =>
    timePartsFromMilliseconds(clip?.endMs ?? firstSource?.durationMs ?? 0),
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const chooseSource = (source: SnapCutSource) => {
    setSourceId(source.id);
    setStartInput(timePartsFromMilliseconds(0));
    setEndInput(timePartsFromMilliseconds(source.durationMs));
    setValidationMessage(null);
  };

  const submit = () => {
    const result = validateClipTimePartsDraft(sourceId, startInput, endInput, sources);
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

          <View style={styles.timeEditors}>
            <TimePartsEditor
              busy={busy}
              invalid={validationMessage !== null}
              label="Start"
              onChange={(value) => {
                setStartInput(value);
                setValidationMessage(null);
              }}
              testIdPrefix="clip-start"
              value={startInput}
            />
            <TimePartsEditor
              busy={busy}
              invalid={validationMessage !== null}
              label="End"
              onChange={(value) => {
                setEndInput(value);
                setValidationMessage(null);
              }}
              onSubmitEditing={submit}
              testIdPrefix="clip-end"
              value={endInput}
            />
          </View>
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
  timeEditors: {
    gap: spacing.sm,
  },
  timePartsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  timePartField: {
    flex: 1,
    minWidth: 0,
  },
  timePartLabel: {
    ...typography.caption,
    marginBottom: spacing.xxs,
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
  timePartInput: {
    textAlign: 'center',
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
