import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  colors,
  formatDuration,
  layout,
  minimumTouchTarget,
  radii,
  spacing,
  typography,
} from '@/constants';
import type { SnapCutSource } from '@/domain';

import { AppButton } from './AppButton';
import { ErrorBanner } from './ErrorBanner';

interface MediaLibraryModalProps {
  visible: boolean;
  sources: readonly SnapCutSource[];
  importBusy: boolean;
  previewSourceId: string | null;
  previewLoading: boolean;
  previewPlaying: boolean;
  inUseSourceIds?: ReadonlySet<string>;
  deletingSourceId?: string | null;
  operationError?: string | null;
  onAddClip: (source: SnapCutSource) => void;
  onClose: () => void;
  onDelete: (source: SnapCutSource) => void;
  onImport: () => void;
  onDismissError?: (() => void) | undefined;
  onPreview: (source: SnapCutSource) => void;
  onRename: (source: SnapCutSource) => void;
}

function PreviewIcon({ pause }: { pause: boolean }) {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d={pause ? 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z' : 'M7 4v16l12-8L7 4Z'}
        fill={colors.textPrimary}
      />
    </Svg>
  );
}

export function MediaLibraryModal({
  visible,
  sources,
  importBusy,
  previewSourceId,
  previewLoading,
  previewPlaying,
  inUseSourceIds = new Set<string>(),
  deletingSourceId = null,
  operationError = null,
  onAddClip,
  onClose,
  onDelete,
  onImport,
  onDismissError,
  onPreview,
  onRename,
}: MediaLibraryModalProps) {
  const confirmDelete = (source: SnapCutSource) => {
    if (inUseSourceIds.has(source.id)) return;
    Alert.alert(
      'Delete source?',
      `“${source.displayName}” will be removed from this project and private app storage.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(source) },
      ],
    );
  };

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
                Media
              </Text>
              <Text style={styles.subtitle}>Preview sources or add a range to Clips.</Text>
            </View>
            <Pressable
              accessibilityLabel="Close media library"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Text accessibilityElementsHidden style={styles.closeIcon}>
                ×
              </Text>
            </Pressable>
          </View>

          {operationError ? (
            <ErrorBanner
              message={operationError}
              {...(onDismissError ? { onDismiss: onDismissError } : {})}
            />
          ) : null}

          <AppButton
            disabled={importBusy}
            fullWidth
            label="Import Audio or Video"
            onPress={onImport}
          />

          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {sources.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No media yet</Text>
                <Text style={styles.emptyMessage}>
                  Import local audio or extract the soundtrack from a video.
                </Text>
              </View>
            ) : (
              sources.map((source) => {
                const activePreview = previewSourceId === source.id;
                const previewBusy = activePreview && previewLoading;
                const sourceInUse = inUseSourceIds.has(source.id);
                const deleting = deletingSourceId === source.id;
                const sourceBusy = previewBusy || deleting;
                const previewLabel = previewBusy
                  ? `Loading ${source.displayName} preview`
                  : activePreview && previewPlaying
                    ? `Pause ${source.displayName}`
                    : `Preview ${source.displayName}`;
                return (
                  <View key={source.id} style={styles.sourceCard}>
                    <View style={styles.sourceHeading}>
                      <View style={styles.sourceCopy}>
                        <Text numberOfLines={1} style={styles.sourceName}>
                          {source.displayName}
                        </Text>
                        <Text style={styles.sourceSummary}>
                          {formatDuration(source.durationMs)}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityLabel={previewLabel}
                        accessibilityRole="button"
                        accessibilityState={{ busy: previewBusy, disabled: sourceBusy }}
                        disabled={sourceBusy}
                        onPress={() => onPreview(source)}
                        style={({ pressed }) => [
                          styles.previewAction,
                          activePreview && styles.activeAction,
                          pressed && styles.pressed,
                        ]}
                      >
                        {previewBusy ? (
                          <Text style={styles.loadingGlyph}>…</Text>
                        ) : (
                          <PreviewIcon pause={activePreview && previewPlaying} />
                        )}
                      </Pressable>
                    </View>
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityLabel={`Rename ${source.displayName}`}
                        accessibilityRole="button"
                        disabled={sourceBusy}
                        onPress={() => onRename(source)}
                        style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
                      >
                        <Text style={styles.actionLabel}>Rename</Text>
                      </Pressable>
                      <Pressable
                        accessibilityHint={
                          sourceInUse ? 'Remove clips that use this source first' : undefined
                        }
                        accessibilityLabel={`Delete ${source.displayName}`}
                        accessibilityRole="button"
                        accessibilityState={{ busy: deleting, disabled: sourceInUse || sourceBusy }}
                        disabled={sourceInUse || sourceBusy}
                        onPress={() => confirmDelete(source)}
                        style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
                      >
                        <Text
                          style={[
                            styles.actionLabel,
                            styles.deleteLabel,
                            sourceInUse && styles.disabledLabel,
                          ]}
                        >
                          {sourceInUse ? 'In use' : deleting ? 'Deleting…' : 'Delete'}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Add clip from ${source.displayName}`}
                        accessibilityRole="button"
                        disabled={sourceBusy}
                        onPress={() => onAddClip(source)}
                        style={({ pressed }) => [styles.addAction, pressed && styles.pressed]}
                      >
                        <Text style={styles.addActionLabel}>Add Clip</Text>
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
    maxHeight: '86%',
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
    padding: spacing.sm,
    gap: spacing.xs,
  },
  sourceHeading: {
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
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xxs,
  },
  previewAction: {
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
  loadingGlyph: {
    color: colors.textPrimary,
    fontSize: 20,
  },
  textAction: {
    minHeight: minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  actionLabel: {
    ...typography.label,
    color: colors.focus,
  },
  deleteLabel: {
    color: colors.error,
  },
  disabledLabel: {
    color: colors.disabledText,
  },
  addAction: {
    minHeight: minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  addActionLabel: {
    ...typography.label,
    color: colors.background,
  },
  pressed: {
    opacity: 0.78,
  },
});
