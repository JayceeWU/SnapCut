import { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';

import {
  colors,
  copy,
  formatBytes,
  formatDuration,
  layout,
  radii,
  spacing,
  typography,
} from '@/constants';
import { validateExportBaseName, type SnapCutExportFormat } from '@/domain';
import { useExportStore } from '@/stores';
import { AppButton } from './AppButton';
import { ErrorBanner } from './ErrorBanner';

interface ExportModalProps {
  visible: boolean;
  onClose: () => void;
  onExport: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onShare: () => void;
}

const formatLabels: Record<SnapCutExportFormat, string> = {
  m4a: copy.export.m4a,
  flac: copy.export.flac,
  mp3: copy.export.mp3,
};

function KeepAwakeGuard() {
  useKeepAwake('SnapCut export');
  return null;
}

export function ExportModal({
  visible,
  onClose,
  onExport,
  onCancel,
  onRetry,
  onShare,
}: ExportModalProps) {
  const status = useExportStore((state) => state.status);
  const preflight = useExportStore((state) => state.preflight);
  const selectedFormat = useExportStore((state) => state.selectedFormat);
  const displayName = useExportStore((state) => state.displayNameWithoutExtension);
  const compositionDurationMs = useExportStore((state) => state.compositionDurationMs);
  const stage = useExportStore((state) => state.stage);
  const progress = useExportStore((state) => state.progress);
  const result = useExportStore((state) => state.result);
  const error = useExportStore((state) => state.error);
  const selectFormat = useExportStore((state) => state.selectFormat);
  const setDisplayName = useExportStore((state) => state.setDisplayName);

  const validName = useMemo(() => {
    try {
      validateExportBaseName(displayName);
      return true;
    } catch {
      return false;
    }
  }, [displayName]);
  const busy = status === 'preflighting' || status === 'exporting' || status === 'cancelling';

  return (
    <Modal
      animationType="fade"
      onRequestClose={busy ? onCancel : onClose}
      transparent
      visible={visible}
    >
      {status === 'exporting' || status === 'cancelling' ? <KeepAwakeGuard /> : null}
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={styles.title}>
              {copy.export.title}
            </Text>

            {status === 'preflighting' ? (
              <View accessibilityLiveRegion="polite" style={styles.centered}>
                <ActivityIndicator color={colors.accent} size="large" />
                <Text style={styles.statusText}>{copy.export.preflighting}</Text>
              </View>
            ) : null}

            {preflight && status !== 'success' ? (
              <>
                <Text style={styles.formatDetail}>
                  {copy.export.compositionDuration(formatDuration(compositionDurationMs))}
                </Text>
                <Text style={styles.fieldLabel}>{copy.export.nameLabel}</Text>
                <TextInput
                  accessibilityLabel={copy.export.nameLabel}
                  editable={!busy}
                  onChangeText={setDisplayName}
                  placeholder={copy.export.namePlaceholder}
                  placeholderTextColor={colors.disabledText}
                  selectionColor={colors.accent}
                  style={styles.input}
                  value={displayName}
                />
                {!validName ? (
                  <Text style={styles.validation}>{copy.export.invalidName}</Text>
                ) : null}

                <Text style={styles.fieldLabel}>{copy.export.formatLabel}</Text>
                {preflight.formats.map((format) => {
                  const selected = selectedFormat === format.format;
                  return (
                    <Pressable
                      accessibilityLabel={formatLabels[format.format]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: !format.available }}
                      disabled={!format.available || busy}
                      key={format.format}
                      onPress={() => selectFormat(format.format)}
                      style={({ pressed }) => [
                        styles.formatCard,
                        selected && styles.formatCardSelected,
                        pressed && styles.formatCardPressed,
                        !format.available && styles.formatCardDisabled,
                      ]}
                    >
                      <View style={styles.formatHeader}>
                        <Text
                          style={[styles.formatTitle, !format.available && styles.disabledText]}
                        >
                          {formatLabels[format.format]}
                        </Text>
                        <View style={[styles.radio, selected && styles.radioSelected]} />
                      </View>
                      {format.available ? (
                        <>
                          <Text style={styles.formatDetail}>
                            {copy.export.estimatedSize(formatBytes(format.estimatedOutputBytes))}
                          </Text>
                          {format.sampleRateHz && format.channelCount ? (
                            <Text style={styles.formatDetail}>
                              {copy.export.sampleRate(format.sampleRateHz)} ·{' '}
                              {copy.export.channels(format.channelCount)}
                            </Text>
                          ) : null}
                          {format.format === 'm4a' &&
                          preflight.m4aPlan.maxBoundaryAdjustmentMs > 0 ? (
                            <Text style={styles.formatDetail}>
                              {copy.export.m4aBoundaryAdjustment(
                                preflight.m4aPlan.maxBoundaryAdjustmentMs,
                              )}
                            </Text>
                          ) : null}
                          {format.format === 'flac' ? (
                            <Text style={styles.formatDetail}>{copy.export.flacSourceCaveat}</Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={styles.unavailableReason}>
                          {format.reasons[0] ?? copy.export.unavailableReason}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </>
            ) : null}

            {status === 'exporting' || status === 'cancelling' ? (
              <View accessibilityLiveRegion="polite" style={styles.progressSection}>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.round(Math.max(0, Math.min(1, progress ?? 0)) * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.statusText}>
                  {status === 'cancelling'
                    ? copy.export.cancelling
                    : copy.export.exporting(
                        stage ?? 'Exporting',
                        progress === null ? null : Math.round(progress * 100),
                      )}
                </Text>
              </View>
            ) : null}

            {status === 'success' && result ? (
              <View accessibilityLiveRegion="polite" style={styles.successSection}>
                <Text style={styles.successTitle}>{copy.export.successTitle}</Text>
                <Text style={styles.statusText}>
                  {copy.export.successMessage(result.displayName)}
                </Text>
                <Text style={styles.formatDetail}>
                  {formatLabels[result.format]} · {formatBytes(result.fileSizeBytes)}
                </Text>
                <Text style={styles.formatDetail}>
                  {copy.export.successDuration(formatDuration(result.actualDurationMs))}
                </Text>
                {result.format === 'm4a' ? (
                  <Text style={styles.formatDetail}>
                    {copy.export.successBoundaryAdjustment(result.maxBoundaryAdjustmentMs)}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {status === 'failed' && error ? <ErrorBanner message={error} /> : null}

            <View style={styles.actions}>
              {status === 'success' ? (
                <>
                  <AppButton label={copy.export.closeAction} onPress={onClose} variant="ghost" />
                  <AppButton label={copy.export.shareAction} onPress={onShare} />
                </>
              ) : status === 'failed' ? (
                <>
                  <AppButton label={copy.export.closeAction} onPress={onClose} variant="ghost" />
                  <AppButton label={copy.export.retryAction} onPress={onRetry} />
                </>
              ) : busy ? (
                <AppButton
                  disabled={status === 'cancelling'}
                  label={copy.export.cancelAction}
                  onPress={onCancel}
                  variant="ghost"
                />
              ) : (
                <>
                  <AppButton label={copy.export.cancelAction} onPress={onClose} variant="ghost" />
                  <AppButton
                    disabled={!validName || selectedFormat === null}
                    label={copy.export.startAction}
                    onPress={onExport}
                  />
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.modalBackdrop,
    justifyContent: 'center',
    padding: spacing.md,
  },
  dialog: {
    ...layout.card,
    maxHeight: '90%',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.screenTitle,
    marginBottom: spacing.sm,
  },
  centered: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  fieldLabel: {
    ...typography.label,
    marginTop: spacing.xs,
  },
  input: {
    ...typography.body,
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
  validation: {
    ...typography.caption,
    color: colors.error,
  },
  formatCard: {
    ...layout.card,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  formatCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTranslucent,
  },
  formatCardPressed: {
    backgroundColor: colors.soft,
  },
  formatCardDisabled: {
    backgroundColor: colors.disabledSurface,
  },
  formatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  formatTitle: {
    ...typography.cardTitle,
  },
  formatDetail: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  unavailableReason: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xxs,
  },
  disabledText: {
    color: colors.disabledText,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.textSecondary,
  },
  radioSelected: {
    borderWidth: 6,
    borderColor: colors.accent,
  },
  progressSection: {
    paddingVertical: spacing.lg,
  },
  progressTrack: {
    height: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.disabledSurface,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  statusText: {
    ...typography.bodySecondary,
    marginTop: spacing.sm,
  },
  successSection: {
    paddingVertical: spacing.md,
  },
  successTitle: {
    ...typography.sectionTitle,
    color: colors.focus,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
