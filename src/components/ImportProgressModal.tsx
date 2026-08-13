import { Modal, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';

import { colors, copy, layout, spacing, typography } from '@/constants';
import { useImportStore, type ImportUiStage } from '@/stores';
import { AppButton } from './AppButton';
import { ErrorBanner } from './ErrorBanner';

interface ImportProgressModalProps {
  visible: boolean;
  onCancel: () => void;
  onClose: () => void;
  onRetry: () => void;
}

const stageLabels: Partial<Record<ImportUiStage, string>> = {
  picking: copy.import.picking,
  inspecting: copy.import.inspecting,
  extracting_or_copying: copy.import.extracting_or_copying,
  verifying: copy.import.verifying,
  committing: copy.import.committing,
  scheduling_waveform: copy.import.scheduling_waveform,
  canceling: copy.import.canceling,
  complete: copy.import.complete,
  cancelled: copy.import.cancelled,
};

function ImportKeepAwake() {
  useKeepAwake('SnapCut import');
  return null;
}

export function ImportProgressModal({
  visible,
  onCancel,
  onClose,
  onRetry,
}: ImportProgressModalProps) {
  const stage = useImportStore((state) => state.stage);
  const fraction = useImportStore((state) => state.fraction);
  const failure = useImportStore((state) => state.failure);
  const active = useImportStore((state) => state.activeJobId !== null);
  const keepAwake = [
    'inspecting',
    'extracting_or_copying',
    'verifying',
    'committing',
    'scheduling_waveform',
  ].includes(stage);
  const terminal = stage === 'complete' || stage === 'cancelled' || stage === 'failed';
  const label = stageLabels[stage] ?? copy.import.inspecting;
  const percent = fraction === null ? null : Math.round(fraction * 100);

  return (
    <Modal
      animationType="fade"
      onRequestClose={active ? onCancel : onClose}
      transparent
      visible={visible}
    >
      {keepAwake ? <ImportKeepAwake /> : null}
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.import.title}
          </Text>
          {failure ? <ErrorBanner message={failure.message} /> : null}
          {!failure ? (
            <View accessibilityLiveRegion="polite">
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.round(Math.max(0, Math.min(1, fraction ?? 0)) * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.status}>{copy.import.progress(label, percent)}</Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            {stage === 'failed' && failure?.retryable ? (
              <>
                <AppButton label={copy.import.closeAction} onPress={onClose} variant="ghost" />
                <AppButton label={copy.import.retryAction} onPress={onRetry} />
              </>
            ) : terminal ? (
              <AppButton label={copy.import.closeAction} onPress={onClose} />
            ) : (
              <AppButton
                disabled={stage === 'committing' || stage === 'canceling'}
                label={copy.import.cancelAction}
                onPress={onCancel}
                variant="ghost"
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.modalBackdrop,
  },
  dialog: {
    ...layout.card,
    padding: spacing.lg,
  },
  title: {
    ...typography.screenTitle,
    marginBottom: spacing.lg,
  },
  track: {
    height: 8,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: colors.disabledSurface,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  status: {
    ...typography.bodySecondary,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
