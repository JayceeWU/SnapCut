import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  compareReadySourceIds?: ReadonlySet<string>;
  inUseSourceIds?: ReadonlySet<string>;
  deletingSourceId?: string | null;
  operationError?: string | null;
  onClose: () => void;
  onCompare: (source: SnapCutSource) => void;
  onDelete: (source: SnapCutSource) => void;
  onImport: () => void;
  onDismissError?: (() => void) | undefined;
  onPreview: (source: SnapCutSource) => void;
  onRename: (source: SnapCutSource) => void;
}

function PreviewIcon({ pause, color }: { pause: boolean; color: string }) {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path d={pause ? 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z' : 'M7 4v16l12-8L7 4Z'} fill={color} />
    </Svg>
  );
}

function RenameIcon({ color }: { color: string }) {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M4 16.5V20h3.5L18.1 9.4l-3.5-3.5L4 16.5Zm16.7-9.9a1 1 0 0 0 0-1.4l-1.9-1.9a1 1 0 0 0-1.4 0l-1.5 1.5 3.5 3.5 1.3-1.7Z"
        fill={color}
      />
    </Svg>
  );
}

function CompareIcon({ color }: { color: string }) {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M4 7h2l1.5-3 3 6 2-4 2.5 5H20M4 17h3l1.5-3 2.5 5 2.5-6 2 4H20"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </Svg>
  );
}

function DeleteIcon({ color }: { color: string }) {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M7 21c-1.1 0-2-.9-2-2V6h14v13c0 1.1-.9 2-2 2H7Zm2-4h2V9H9v8Zm4 0h2V9h-2v8ZM4 5V3h5l1-1h4l1 1h5v2H4Z"
        fill={color}
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
  compareReadySourceIds = new Set<string>(),
  inUseSourceIds = new Set<string>(),
  deletingSourceId = null,
  operationError = null,
  onClose,
  onCompare,
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
            <Text accessibilityRole="header" style={styles.title}>
              Sources
            </Text>
            <Pressable
              accessibilityLabel="Close sources"
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
                const compareReady = compareReadySourceIds.has(source.id);
                const deleting = deletingSourceId === source.id;
                const sourceBusy = previewBusy || deleting;
                const previewLabel = previewBusy
                  ? `Loading ${source.displayName} preview`
                  : activePreview && previewPlaying
                    ? `Pause ${source.displayName}`
                    : `Preview ${source.displayName}`;
                return (
                  <View
                    key={source.id}
                    style={styles.sourceCard}
                    testID={`source-card-${source.id}`}
                  >
                    <View style={styles.sourceCopy} testID={`source-copy-${source.id}`}>
                      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.sourceName}>
                        {source.displayName}
                      </Text>
                      <Text numberOfLines={1} style={styles.sourceSummary}>
                        {formatDuration(source.durationMs)}
                      </Text>
                    </View>
                    <View style={styles.actions} testID={`source-actions-${source.id}`}>
                      <Pressable
                        accessibilityLabel={previewLabel}
                        accessibilityRole="button"
                        accessibilityState={{ busy: previewBusy, disabled: sourceBusy }}
                        disabled={sourceBusy}
                        onPress={() => onPreview(source)}
                        style={({ pressed }) => [
                          styles.previewAction,
                          activePreview && styles.activeAction,
                          sourceBusy && styles.disabledAction,
                          pressed && styles.pressed,
                        ]}
                        testID={`source-preview-action-${source.id}`}
                      >
                        {previewBusy ? (
                          <ActivityIndicator color={colors.textPrimary} size="small" />
                        ) : (
                          <PreviewIcon
                            color={sourceBusy ? colors.disabledText : colors.textPrimary}
                            pause={activePreview && previewPlaying}
                          />
                        )}
                      </Pressable>
                      <Pressable
                        accessibilityHint={
                          compareReady ? undefined : 'Wait for this source waveform to finish'
                        }
                        accessibilityLabel={`Compare ${source.displayName}`}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !compareReady || sourceBusy }}
                        disabled={!compareReady || sourceBusy}
                        onPress={() => onCompare(source)}
                        style={({ pressed }) => [
                          styles.actionButton,
                          (!compareReady || sourceBusy) && styles.disabledAction,
                          pressed && styles.pressed,
                        ]}
                        testID={`source-compare-action-${source.id}`}
                      >
                        <CompareIcon
                          color={!compareReady || sourceBusy ? colors.disabledText : colors.focus}
                        />
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Rename ${source.displayName}`}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: sourceBusy }}
                        disabled={sourceBusy}
                        onPress={() => onRename(source)}
                        style={({ pressed }) => [
                          styles.actionButton,
                          sourceBusy && styles.disabledAction,
                          pressed && styles.pressed,
                        ]}
                        testID={`source-rename-action-${source.id}`}
                      >
                        <RenameIcon color={sourceBusy ? colors.disabledText : colors.focus} />
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
                        style={({ pressed }) => [
                          styles.actionButton,
                          (sourceInUse || sourceBusy) && styles.disabledAction,
                          pressed && styles.pressed,
                        ]}
                        testID={`source-delete-action-${source.id}`}
                      >
                        {deleting ? (
                          <ActivityIndicator color={colors.disabledText} size="small" />
                        ) : (
                          <DeleteIcon
                            color={sourceInUse || sourceBusy ? colors.disabledText : colors.error}
                          />
                        )}
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
  title: {
    ...typography.screenTitle,
    flex: 1,
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
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.xxs,
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
    flexShrink: 0,
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
  actionButton: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  disabledAction: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.78,
  },
});
