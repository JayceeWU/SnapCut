import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  copy,
  formatDuration,
  layout,
  minimumTouchTarget,
  radii,
  spacing,
  typography,
} from '@/constants';
import type { SnapCutSource } from '@/domain';

import { AppButton } from './AppButton';

interface MediaLibraryModalProps {
  visible: boolean;
  sources: readonly SnapCutSource[];
  importBusy: boolean;
  previewSourceId: string | null;
  previewLoading: boolean;
  previewPlaying: boolean;
  onAddFull: (source: SnapCutSource) => void;
  onClose: () => void;
  onImport: () => void;
  onPreview: (source: SnapCutSource) => void;
}

export function MediaLibraryModal({
  visible,
  sources,
  importBusy,
  previewSourceId,
  previewLoading,
  previewPlaying,
  onAddFull,
  onClose,
  onImport,
  onPreview,
}: MediaLibraryModalProps) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable
        accessible={false}
        onPress={onClose}
        style={styles.backdrop}
        testID="media-library-backdrop"
      >
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          onPress={(event) => event.stopPropagation()}
          style={styles.dialog}
          testID="media-library-dialog"
        >
          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <Text accessibilityRole="header" style={styles.title}>
                {copy.editor.mediaTitle}
              </Text>
              <Text style={styles.subtitle}>{copy.editor.mediaSubtitle}</Text>
            </View>
            <Pressable
              accessibilityLabel={copy.editor.mediaCloseAction}
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Text accessibilityElementsHidden style={styles.closeIcon}>
                ×
              </Text>
            </Pressable>
          </View>

          <AppButton
            disabled={importBusy}
            fullWidth
            label={copy.editor.mediaImportAction}
            onPress={onImport}
          />

          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {sources.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{copy.editor.mediaEmptyTitle}</Text>
                <Text style={styles.emptyMessage}>{copy.editor.mediaEmptyMessage}</Text>
              </View>
            ) : (
              sources.map((source) => {
                const activePreview = previewSourceId === source.id;
                const previewBusy = activePreview && previewLoading;
                const previewIcon = previewBusy ? '…' : activePreview && previewPlaying ? 'Ⅱ' : '▶';
                const previewLabel = previewBusy
                  ? copy.editor.mediaPreviewLoading(source.displayName)
                  : activePreview && previewPlaying
                    ? copy.editor.mediaPauseAction(source.displayName)
                    : copy.editor.mediaPreviewAction(source.displayName);
                return (
                  <View key={source.id} style={styles.sourceCard}>
                    <View style={styles.sourceCopy}>
                      <Text numberOfLines={1} style={styles.sourceName}>
                        {source.displayName}
                      </Text>
                      <Text style={styles.sourceSummary}>{formatDuration(source.durationMs)}</Text>
                    </View>
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityLabel={previewLabel}
                        accessibilityRole="button"
                        accessibilityState={{ busy: previewBusy, disabled: previewBusy }}
                        disabled={previewBusy}
                        onPress={() => onPreview(source)}
                        style={({ pressed }) => [
                          styles.sourceAction,
                          activePreview && styles.activeAction,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text accessibilityElementsHidden style={styles.previewIcon}>
                          {previewIcon}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={copy.editor.mediaAddAction(source.displayName)}
                        accessibilityRole="button"
                        onPress={() => onAddFull(source)}
                        style={({ pressed }) => [styles.addAction, pressed && styles.pressed]}
                      >
                        <Text accessibilityElementsHidden style={styles.addIcon}>
                          +
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.modalBackdrop,
    padding: spacing.md,
  },
  dialog: {
    ...layout.card,
    width: '100%',
    maxWidth: 520,
    maxHeight: '82%',
    padding: spacing.md,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headingCopy: {
    flex: 1,
  },
  title: {
    ...typography.screenTitle,
  },
  subtitle: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  iconButton: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  closeIcon: {
    color: colors.textPrimary,
    fontSize: 28,
    lineHeight: 30,
  },
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    ...typography.cardTitle,
  },
  emptyMessage: {
    ...typography.bodySecondary,
    maxWidth: 300,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  sourceCard: {
    ...layout.card,
    minHeight: 72,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sourceCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceName: {
    ...typography.cardTitle,
  },
  sourceSummary: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  sourceAction: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  activeAction: {
    borderColor: colors.focus,
    backgroundColor: colors.soft,
  },
  addAction: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  previewIcon: {
    color: colors.textPrimary,
    fontSize: 20,
  },
  addIcon: {
    color: colors.background,
    fontSize: 28,
    lineHeight: 30,
  },
  pressed: {
    opacity: 0.78,
  },
});
