import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AppButton,
  ClipCard,
  ConfirmDeleteModal,
  EmptyState,
  ErrorBanner,
  ExportModal,
  ImportProgressModal,
  PlaybackControls,
  ProjectNameModal,
  SelectionControls,
  SourceSelector,
  WaveformEditor,
  WaveformJobPanel,
} from '@/components';
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
import {
  addClip,
  completeProjectNamePrompt,
  deleteClip,
  duplicateClip,
  moveClipEarlier,
  moveClipLater,
  shouldPromptForProjectName,
  updateClip,
  type SnapCutClip,
  type SnapCutSource,
} from '@/domain';
import {
  cancelActiveImportRuntime,
  exportCoordinator,
  getImportRuntime,
  previewCoordinator,
} from '@/services';
import {
  resetImportStore,
  useEditorStore,
  useExportStore,
  useImportStore,
  usePlaybackStore,
  useProjectStore,
  useWaveformJobStore,
  waveformJobKey,
} from '@/stores';

function getRouteId(id: string | string[] | undefined): string | null {
  if (typeof id === 'string' && id.length > 0) return id;
  return Array.isArray(id) && id[0] ? id[0] : null;
}

interface MetadataItemProps {
  label: string;
  value: string;
}

function MetadataItem({ label, value }: MetadataItemProps) {
  return (
    <View style={styles.metadataItem}>
      <Text style={styles.metadataLabel}>{label}</Text>
      <Text style={styles.metadataValue}>{value}</Text>
    </View>
  );
}

export default function ProjectEditorScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const projectId = getRouteId(params.id);
  const project = useProjectStore((state) => state.activeProject);
  const repairStatus = useProjectStore((state) =>
    projectId ? state.repairStatuses[projectId] : undefined,
  );
  const loading = useProjectStore((state) => state.loadingProject);
  const mutation = useProjectStore((state) => state.mutation);
  const error = useProjectStore((state) => state.error);
  const loadProject = useProjectStore((state) => state.loadProject);
  const clearActiveProject = useProjectStore((state) => state.clearActiveProject);
  const clearError = useProjectStore((state) => state.clearError);
  const renameProject = useProjectStore((state) => state.renameProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const updateProject = useProjectStore((state) => state.updateProject);

  const selectedSourceId = useEditorStore((state) => state.selectedSourceId);
  const editingClipId = useEditorStore((state) => state.editingClipId);
  const selectionStartMs = useEditorStore((state) => state.selectionStartMs);
  const selectionEndMs = useEditorStore((state) => state.selectionEndMs);
  const zoom = useEditorStore((state) => state.zoom);
  const viewportStartMs = useEditorStore((state) => state.viewportStartMs);
  const waveform = useEditorStore((state) => state.waveform);
  const waveformLoadState = useEditorStore((state) => state.waveformLoadState);
  const syncEditorProject = useEditorStore((state) => state.syncProject);
  const selectSource = useEditorStore((state) => state.selectSource);
  const setSelectionStartMs = useEditorStore((state) => state.setSelectionStartMs);
  const setSelectionEndMs = useEditorStore((state) => state.setSelectionEndMs);
  const beginEditing = useEditorStore((state) => state.beginEditing);
  const cancelEditing = useEditorStore((state) => state.cancelEditing);
  const setZoom = useEditorStore((state) => state.setZoom);
  const panViewport = useEditorStore((state) => state.panViewport);
  const resetEditor = useEditorStore((state) => state.reset);
  const selectedWaveformJob = useWaveformJobStore((state) =>
    projectId && selectedSourceId
      ? state.jobs[waveformJobKey(projectId, selectedSourceId)]
      : undefined,
  );

  const previewAvailable = usePlaybackStore((state) => state.available);
  const playbackProjectId = usePlaybackStore((state) => state.projectId);
  const playbackMode = usePlaybackStore((state) => state.mode);
  const playbackLoading = usePlaybackStore((state) => state.loading);
  const playbackLoaded = usePlaybackStore((state) => state.loaded);
  const playbackPlaying = usePlaybackStore((state) => state.playing);
  const playbackPositionMs = usePlaybackStore((state) => state.positionMs);
  const playbackDurationMs = usePlaybackStore((state) => state.durationMs);
  const playbackError = usePlaybackStore((state) => state.error);
  const clearPlaybackError = usePlaybackStore((state) => state.clearError);

  const [showActions, setShowActions] = useState(false);
  const [renameReason, setRenameReason] = useState<'manual' | 'first-clip' | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const exportStatus = useExportStore((state) => state.status);
  const exportResult = useExportStore((state) => state.result);
  const importActive = useImportStore((state) => state.activeJobId !== null);

  useEffect(() => {
    if (projectId) void loadProject(projectId);
    return () => {
      if (projectId) void previewCoordinator.releaseProject(projectId).catch(() => undefined);
      void exportCoordinator.cancel().catch(() => undefined);
      void cancelActiveImportRuntime().catch(() => undefined);
      clearActiveProject();
      resetEditor();
    };
  }, [clearActiveProject, loadProject, projectId, resetEditor]);

  useEffect(() => {
    if (project && project.id === projectId) syncEditorProject(project);
  }, [project, projectId, syncEditorProject]);

  useEffect(() => {
    if (
      projectId &&
      (selectedWaveformJob?.status === 'ready' ||
        selectedWaveformJob?.status === 'failed' ||
        selectedWaveformJob?.status === 'pending')
    ) {
      void loadProject(projectId);
    }
  }, [loadProject, projectId, selectedWaveformJob?.jobId, selectedWaveformJob?.status]);

  const selectedSource = useMemo<SnapCutSource | undefined>(
    () => project?.sources.find((source) => source.id === selectedSourceId),
    [project, selectedSourceId],
  );

  if (loading && !project) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingLabel}>{copy.editor.loading}</Text>
      </SafeAreaView>
    );
  }

  if (!project || project.id !== projectId || repairStatus?.state === 'needs-repair') {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        {error ? <ErrorBanner message={error} onDismiss={clearError} /> : null}
        <EmptyState
          actionLabel={copy.editor.backAction}
          message={copy.editor.notFoundMessage}
          onAction={() => router.replace('/')}
          title={copy.editor.notFoundTitle}
        />
      </SafeAreaView>
    );
  }

  const durationMs = project.clips.reduce(
    (total, clip) => total + Math.max(0, clip.endMs - clip.startMs),
    0,
  );
  const selectionValid =
    selectedSource !== undefined &&
    Number.isInteger(selectionStartMs) &&
    Number.isInteger(selectionEndMs) &&
    selectionStartMs >= 0 &&
    selectionEndMs <= selectedSource.durationMs &&
    selectionEndMs - selectionStartMs >= 100;
  const saving = mutation === 'save';
  const activeRenameReason =
    renameReason ?? (shouldPromptForProjectName(project) ? 'first-clip' : null);

  const submitRename = async (name: string) => {
    if (await renameProject(project.id, name)) setRenameReason(null);
  };

  const cancelRename = async () => {
    if (activeRenameReason !== 'first-clip') {
      setRenameReason(null);
      return;
    }
    const saved = await updateProject(project.id, completeProjectNamePrompt);
    if (saved) setRenameReason(null);
  };

  const confirmDelete = async () => {
    if (await deleteProject(project.id)) {
      setShowDelete(false);
      router.replace('/');
    }
  };

  const saveSelection = async () => {
    if (!selectionValid || !selectedSource) return;
    const clipId = editingClipId;
    const saved = await updateProject(project.id, (currentProject) =>
      clipId
        ? updateClip(currentProject, clipId, {
            sourceId: selectedSource.id,
            startMs: selectionStartMs,
            endMs: selectionEndMs,
          })
        : addClip(currentProject, {
            id: randomUUID(),
            sourceId: selectedSource.id,
            startMs: selectionStartMs,
            endMs: selectionEndMs,
          }),
    );
    if (saved && clipId) cancelEditing();
  };

  const editExistingClip = (clip: SnapCutClip) => {
    const source = project.sources.find(({ id }) => id === clip.sourceId);
    if (source) beginEditing(clip, source);
  };

  const updateClips = (operation: Parameters<typeof updateProject>[1]) =>
    void updateProject(project.id, operation);

  const prepareExport = () => {
    setShowExport(true);
    void exportCoordinator.prepare(project).catch(() => undefined);
  };

  const importMedia = () => {
    const runtime = getImportRuntime();
    setShowImport(true);
    void runtime.coordinator.importIntoProject(project.id).then(async (outcome) => {
      if (outcome.status !== 'imported') return;
      await loadProject(project.id);
      void runtime.waveformScheduler.whenIdle().then(() => loadProject(project.id));
    });
  };

  const startSelectedWaveform = () => {
    if (!selectedSource) return;
    getImportRuntime().waveformScheduler.schedule({
      projectId: project.id,
      sourceId: selectedSource.id,
    });
  };

  const cancelSelectedWaveform = () => {
    if (!selectedSource) return;
    void getImportRuntime()
      .waveformScheduler.cancel(project.id, selectedSource.id)
      .then(() => loadProject(project.id));
  };

  const closeImport = () => {
    if (importActive) return;
    setShowImport(false);
    resetImportStore();
  };

  const runExport = () => {
    void exportCoordinator
      .export(project)
      .then((record) =>
        updateProject(project.id, (current) => ({ ...current, lastExport: record })),
      )
      .catch(() => undefined);
  };

  const closeExport = () => {
    if (exportStatus === 'exporting' || exportStatus === 'cancelling') return;
    setShowExport(false);
    exportCoordinator.reset();
  };

  const previewSelectedRange = () => {
    if (!selectedSource || !selectionValid) return;
    void previewCoordinator
      .toggleSelection(project, {
        id: editingClipId ?? randomUUID(),
        sourceId: selectedSource.id,
        startMs: selectionStartMs,
        endMs: selectionEndMs,
      })
      .catch(() => undefined);
  };

  const activePlaybackMode = playbackProjectId === project.id ? playbackMode : null;
  const activePlaybackLoaded = playbackProjectId === project.id && playbackLoaded;
  const activePlaybackLoading = playbackProjectId === project.id && playbackLoading;
  const activePlaybackPlaying = playbackProjectId === project.id && playbackPlaying;
  const activePlaybackPositionMs = playbackProjectId === project.id ? playbackPositionMs : 0;
  const activePlaybackDurationMs = playbackProjectId === project.id ? playbackDurationMs : 0;
  const selectionPlayheadMs =
    activePlaybackMode === 'selection' && activePlaybackLoaded
      ? Math.min(selectionEndMs, selectionStartMs + activePlaybackPositionMs)
      : null;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={copy.editor.backAction}
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Text accessibilityElementsHidden style={styles.backIcon}>
              ‹
            </Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.projectTitle}>
            {project.name}
          </Text>
          <Pressable
            accessibilityLabel={copy.editor.actionsLabel}
            accessibilityRole="button"
            accessibilityState={{ expanded: showActions }}
            onPress={() => setShowActions((visible) => !visible)}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Text accessibilityElementsHidden style={styles.menuIcon}>
              •••
            </Text>
          </Pressable>
        </View>

        {showActions ? (
          <View style={styles.actionsMenu}>
            <AppButton
              label={copy.editor.renameAction}
              onPress={() => {
                setShowActions(false);
                setRenameReason('manual');
              }}
              variant="ghost"
            />
            <AppButton
              label={copy.editor.deleteAction}
              onPress={() => {
                setShowActions(false);
                setShowDelete(true);
              }}
              variant="ghost"
            />
          </View>
        ) : null}

        {error ? <ErrorBanner message={error} onDismiss={clearError} /> : null}
        {playbackError && playbackProjectId === project.id ? (
          <ErrorBanner message={playbackError} onDismiss={clearPlaybackError} />
        ) : null}

        <AppButton
          accessibilityHint={copy.editor.addMediaUnavailableHint}
          disabled={importActive}
          fullWidth
          label={copy.editor.addMediaAction}
          onPress={importMedia}
        />

        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {copy.editor.sourcesTitle}
        </Text>
        {project.sources.length === 0 ? (
          <EmptyState
            compact
            message={copy.editor.sourcesEmptyMessage}
            testID="empty-project-editor"
            title={copy.editor.sourcesEmptyTitle}
          />
        ) : (
          <>
            <SourceSelector
              onSelect={(source) => selectSource(project.id, source)}
              selectedSourceId={selectedSourceId}
              sources={project.sources}
            />
            {selectedSource ? (
              <View style={styles.sourcePanel}>
                <Text style={styles.selectedSourceLabel}>{copy.editor.selectedSource}</Text>
                <Text numberOfLines={2} style={styles.sourceName}>
                  {selectedSource.displayName}
                </Text>
                <View style={styles.metadataGrid}>
                  <MetadataItem
                    label={copy.editor.sourceDurationLabel}
                    value={formatDuration(selectedSource.durationMs)}
                  />
                  <MetadataItem
                    label={copy.editor.sourceCodecLabel}
                    value={selectedSource.codecMime}
                  />
                  <MetadataItem
                    label={copy.editor.sourceSampleRateLabel}
                    value={copy.editor.sampleRate(selectedSource.sampleRateHz)}
                  />
                  <MetadataItem
                    label={copy.editor.sourceChannelsLabel}
                    value={copy.editor.channels(selectedSource.channelCount)}
                  />
                </View>

                <Text accessibilityRole="header" style={styles.selectionTitle}>
                  {copy.editor.selectionTitle}
                </Text>
                <WaveformEditor
                  durationMs={selectedSource.durationMs}
                  endMs={selectionEndMs}
                  loadState={waveformLoadState}
                  onEndChange={(value) => setSelectionEndMs(value, selectedSource.durationMs)}
                  onStartChange={(value) => setSelectionStartMs(value, selectedSource.durationMs)}
                  onViewportStartChange={(delta) => panViewport(delta, selectedSource.durationMs)}
                  onZoomChange={(value) => setZoom(value, selectedSource.durationMs)}
                  playheadMs={selectionPlayheadMs}
                  startMs={selectionStartMs}
                  viewportStartMs={viewportStartMs}
                  waveform={waveform}
                  zoom={zoom}
                />
                <WaveformJobPanel
                  job={selectedWaveformJob}
                  onCancel={cancelSelectedWaveform}
                  onStart={startSelectedWaveform}
                  sourceStatus={selectedSource.waveformStatus}
                />
                <SelectionControls
                  endMs={selectionEndMs}
                  onEndChange={(value) => setSelectionEndMs(value, selectedSource.durationMs)}
                  onStartChange={(value) => setSelectionStartMs(value, selectedSource.durationMs)}
                  startMs={selectionStartMs}
                />
                {!selectionValid ? (
                  <Text accessibilityLiveRegion="polite" style={styles.rangeError}>
                    {copy.editor.invalidRangeError}
                  </Text>
                ) : null}
                <View style={styles.editorActions}>
                  <PlaybackControls
                    activeMode={activePlaybackMode}
                    available={previewAvailable}
                    disabled={!selectionValid}
                    durationMs={activePlaybackDurationMs}
                    loaded={activePlaybackLoaded}
                    loading={activePlaybackLoading}
                    mode="selection"
                    onSeek={(positionMs) =>
                      void previewCoordinator.seek(positionMs).catch(() => undefined)
                    }
                    onToggle={previewSelectedRange}
                    playing={activePlaybackPlaying}
                    positionMs={activePlaybackPositionMs}
                    unavailableHint={copy.editor.selectionPreviewUnavailable}
                  />
                  {editingClipId ? (
                    <AppButton
                      disabled={saving}
                      label={copy.editor.cancelEditAction}
                      onPress={cancelEditing}
                      variant="ghost"
                    />
                  ) : null}
                  <AppButton
                    disabled={!selectionValid || saving}
                    label={editingClipId ? copy.editor.saveClipAction : copy.editor.addClipAction}
                    loading={saving}
                    onPress={() => void saveSelection()}
                  />
                </View>
              </View>
            ) : null}
          </>
        )}

        <View style={styles.sectionHeadingRow}>
          <Text accessibilityRole="header" style={styles.sectionTitleInline}>
            {copy.editor.compositionTitle}
          </Text>
          <Text style={styles.compositionSummary}>
            {copy.editor.compositionSummary(project.clips.length, formatDuration(durationMs))}
          </Text>
        </View>
        {project.clips.length === 0 ? (
          <EmptyState
            compact
            message={copy.editor.clipsEmptyMessage}
            testID="empty-clip-list"
            title={copy.editor.clipsEmptyTitle}
          />
        ) : (
          project.clips.map((clip, index) => (
            <ClipCard
              clip={clip}
              clipCount={project.clips.length}
              index={index}
              key={clip.id}
              onDelete={() => updateClips((current) => deleteClip(current, clip.id))}
              onDuplicate={() =>
                updateClips((current) => duplicateClip(current, clip.id, randomUUID()))
              }
              onEdit={() => editExistingClip(clip)}
              onMoveEarlier={() => updateClips((current) => moveClipEarlier(current, clip.id))}
              onMoveLater={() => updateClips((current) => moveClipLater(current, clip.id))}
              source={project.sources.find((source) => source.id === clip.sourceId)}
            />
          ))
        )}

        <View style={styles.compositionActions}>
          <PlaybackControls
            activeMode={activePlaybackMode}
            available={previewAvailable}
            disabled={project.clips.length === 0}
            durationMs={activePlaybackDurationMs}
            loaded={activePlaybackLoaded}
            loading={activePlaybackLoading}
            mode="composition"
            onSeek={(positionMs) => void previewCoordinator.seek(positionMs).catch(() => undefined)}
            onToggle={() =>
              void previewCoordinator.toggleComposition(project).catch(() => undefined)
            }
            playing={activePlaybackPlaying}
            positionMs={activePlaybackPositionMs}
            unavailableHint={copy.editor.compositionPreviewUnavailable}
          />
          <AppButton
            accessibilityHint={
              project.clips.length === 0 ? copy.editor.exportDisabledHint : copy.editor.exportHint
            }
            disabled={project.clips.length === 0}
            label={copy.editor.exportAction}
            onPress={prepareExport}
          />
        </View>
      </ScrollView>

      <ProjectNameModal
        busy={mutation === 'rename' || (activeRenameReason === 'first-clip' && mutation === 'save')}
        initialName={project.name}
        onCancel={() => void cancelRename()}
        onSubmit={(name) => void submitRename(name)}
        visible={activeRenameReason !== null}
      />
      <ConfirmDeleteModal
        busy={mutation === 'delete'}
        onCancel={() => setShowDelete(false)}
        onConfirm={() => void confirmDelete()}
        projectName={project.name}
        visible={showDelete}
      />
      <ExportModal
        onCancel={() => void exportCoordinator.cancel().catch(() => undefined)}
        onClose={closeExport}
        onExport={runExport}
        onRetry={() => void exportCoordinator.prepare(project).catch(() => undefined)}
        onShare={() => {
          if (exportResult) {
            void exportCoordinator.share(exportResult).catch(() => {
              useExportStore.getState().fail(copy.export.shareError);
            });
          }
        }}
        visible={showExport}
      />
      <ImportProgressModal
        onCancel={() => void getImportRuntime().coordinator.cancelActive()}
        onClose={closeImport}
        onRetry={importMedia}
        visible={showImport}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    ...layout.screen,
  },
  centeredScreen: {
    ...layout.screen,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  loadingLabel: {
    ...typography.bodySecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  content: {
    ...layout.screenContent,
    paddingTop: spacing.sm,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  projectTitle: {
    ...typography.screenTitle,
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
  iconButton: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  backIcon: {
    color: colors.focus,
    fontSize: 38,
    lineHeight: 40,
  },
  menuIcon: {
    color: colors.focus,
    fontSize: 20,
    letterSpacing: 1,
  },
  actionsMenu: {
    ...layout.card,
    alignSelf: 'flex-end',
    minWidth: 190,
    marginBottom: spacing.md,
    padding: spacing.xxs,
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitleInline: {
    ...typography.sectionTitle,
  },
  compositionSummary: {
    ...typography.caption,
  },
  sourcePanel: {
    ...layout.card,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  selectedSourceLabel: {
    ...typography.caption,
    color: colors.focus,
    fontWeight: '700',
  },
  sourceName: {
    ...typography.cardTitle,
    marginTop: spacing.xxs,
  },
  metadataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  metadataItem: {
    minWidth: 120,
    flexGrow: 1,
  },
  metadataLabel: {
    ...typography.caption,
  },
  metadataValue: {
    ...typography.label,
    marginTop: spacing.xxs,
  },
  selectionTitle: {
    ...typography.sectionTitle,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  rangeError: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.sm,
  },
  editorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  compositionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
});
