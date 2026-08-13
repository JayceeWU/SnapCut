import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, copy, formatDuration, radii, spacing, typography } from '@/constants';

interface ExactTimeInputProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}

function ExactTimeInput({ label, value, onCommit }: ExactTimeInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);

  const commit = () => {
    if (!/^\d+$/.test(draft)) {
      setError(true);
      return;
    }
    const milliseconds = Number(draft);
    if (!Number.isSafeInteger(milliseconds)) {
      setError(true);
      return;
    }
    setError(false);
    setFocused(false);
    onCommit(milliseconds);
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="number-pad"
        onBlur={commit}
        onChangeText={(text) => {
          setDraft(text);
          setError(false);
        }}
        onFocus={() => {
          setDraft(String(value));
          setFocused(true);
        }}
        onSubmitEditing={commit}
        returnKeyType="done"
        selectionColor={colors.focus}
        style={[styles.input, error && styles.inputError]}
        value={focused ? draft : String(value)}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {copy.editor.invalidTimeError}
        </Text>
      ) : null}
    </View>
  );
}

interface SelectionControlsProps {
  startMs: number;
  endMs: number;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
}

export function SelectionControls({
  startMs,
  endMs,
  onStartChange,
  onEndChange,
}: SelectionControlsProps) {
  return (
    <View style={styles.container}>
      <View style={styles.fields}>
        <ExactTimeInput
          label={copy.editor.selectionStartLabel}
          onCommit={onStartChange}
          value={startMs}
        />
        <ExactTimeInput
          label={copy.editor.selectionEndLabel}
          onCommit={onEndChange}
          value={endMs}
        />
      </View>
      <View style={styles.durationRow}>
        <Text style={styles.durationLabel}>{copy.editor.selectionDurationLabel}</Text>
        <Text testID="selection-duration" style={styles.durationValue}>
          {formatDuration(Math.max(0, endMs - startMs))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
  fields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  field: {
    flexGrow: 1,
    flexBasis: 140,
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
    fontSize: 17,
    paddingHorizontal: spacing.md,
  },
  inputError: {
    borderColor: colors.error,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  durationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  durationLabel: {
    ...typography.bodySecondary,
  },
  durationValue: {
    ...typography.label,
    color: colors.focus,
  },
});
