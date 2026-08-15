import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ClipEditModal,
  CompositionWaveform,
  EmptyState,
  ErrorBanner,
  ExportModal,
  ImportProgressModal,
  MediaLibraryModal,
  PlaybackControls,
  ProjectNameModal,
  SequentialClipList,
  SourceNameModal,
  type ClipRangeDraft,
} from '@/components';
import { colors, copy, layout, minimumTouchTarget, radii, spacing, typography } from '@/constants';
import {
  addClip,
  completeProjectNamePrompt,
  compositionDurationMs,
  deleteClip,
  reorderClip,
  shouldPromptForProjectName,
  updateClip,
  type SnapCutClip,
  type SnapCutProject,
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
  useClipEditHistoryStore,
  useEditorStore,
  useExportStore,
  useImportStore,
  usePlaybackStore,
  useProjectStore,
  useWaveformJobStore,
} from '@/stores';

function getRouteId(id: string | string[] | undefined): string | null {
  if (typeof id === 'string' && id.length > 0) return id;
  return Array.isArray(id) && id[0] ? id[0] : null;
}

function useLiveCompositionCursor(projectId: string, fallbackCursorMs: number): number {
  return usePlaybackStore((state) =>
    state.projectId === projectId &&
    state.mode === 'composition' &&
    (state.desiredPlaying || state.playing)
      ? state.positionMs
      : fallbackCursorMs,
  );
}

function LiveCompositionWaveform({
  projectId,
  fallbackCursorMs,
  ...props
}: Omit<ComponentProps<typeof CompositionWaveform>, 'cursorMs'> & {
  projectId: string;
  fallbackCursorMs: number;
}) {
  const cursorMs = useLiveCompositionCursor(projectId, fallbackCursorMs);
  return <CompositionWaveform {...props} cursorMs={cursorMs} />;
}

function LivePlaybackControls({
  projectId,
  fallbackPositionMs,
  fallbackDurationMs,
  ...props
}: Omit<
  ComponentProps<typeof PlaybackControls>,
  'positionMs' | 'durationMs' | 'loading' | 'playing'
> & {
  projectId: string;
  fallbackPositionMs: number;
  fallbackDurationMs: number;
}) {
  const active = usePlaybackStore(
    (state) => state.projectId === projectId && state.mode === 'composition',
  );
  const positionMs = usePlaybackStore((state) =>
    active && (state.desiredPlaying || state.playing) ? state.positionMs : fallbackPositionMs,
  );
  const durationMs = usePlaybackStore((state) =>
    active && state.loaded ? state.durationMs : fallbackDurationMs,
  );
  const loading = usePlaybackStore((state) => active && state.loading);
  const playing = usePlaybackStore((state) => active && state.desiredPlaying);
  return (
    <PlaybackControls
      {...props}
      durationMs={durationMs}
      loading={loading}
      playing={playing}
      positionMs={positionMs}
    />
  );
}

type ClipEditorState =
  { mode: 'add'; sourceId: string | null } | { mode: 'edit'; clipId: string } | null;

type SourceNameEditorState = {
  sourceId: string;
  reason: 'import' | 'rename';
} | null;

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
  const renameSource = useProjectStore((state) => state.renameSource);
  const deleteSource = useProjectStore((state) => state.deleteSource);
  const updateProject = useProjectStore((state) => state.updateProject);

  const waveformsBySourceId = useEditorStore((state) => state.waveformsBySourceId);
  const timelineCursorMs = useEditorStore((state) => state.timelineCursorMs);
  const syncEditorProject = useEditorStore((state) => state.syncProject);
  const setTimelineCursorMs = useEditorStore((state) => state.setTimelineCursorMs);
  const resetEditor = useEditorStore((state) => state.reset);
  const waveformRevision = useWaveformJobStore((state) =>
    Object.values(state.jobs)
      .filter((job) => job.projectId === projectId)
      .map((job) => `${job.sourceId}:${job.status}:${job.fraction ?? ''}`)
      .sort()
      .join('|'),
  );

  const previewAvailable = usePlaybackStore((state) => state.available);
  const playbackProjectId = usePlaybackStore((state) => state.projectId);
  const playbackMode = usePlaybackStore((state) => state.mode);
  const playbackLoading = usePlaybackStore((state) => state.loading);
  const playbackPlaying = usePlaybackStore((state) => state.playing);
  const playbackDesiredPlaying = usePlaybackStore((state) => state.desiredPlaying);
  const playbackCurrentClipId = usePlaybackStore((state) => state.currentClipId);
  const playbackError = usePlaybackStore((state) => state.error);
  const clearPlaybackError = usePlaybackStore((state) => state.clearError);

  const canUndo = useClipEditHistoryStore((state) => state.canUndo);
  const canRedo = useClipEditHistoryStore((state) => state.canRedo);
  const syncEditHistoryProject = useClipEditHistoryStore((state) => state.syncProject);
  const resetEditHistory = useClipEditHistoryStore((state) => state.reset);

  const [renameReason, setRenameReason] = useState<'first-export' | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importReloadFailed, setImportReloadFailed] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [clipEditor, setClipEditor] = useState<ClipEditorState>(null);
  const [sourceNameEditor, setSourceNameEditor] = useState<SourceNameEditorState>(null);
  const [requestedPreviewSourceId, setRequestedPreviewSourceId] = useState<string | null>(null);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyCommandLocked = useRef(false);

  const exportStatus = useExportStore((state) => state.status);
  const exportResult = useExportStore((state) => state.result);
  const importActive = useImportStore((state) => state.activeJobId !== null);

  useEffect(() => {
    syncEditHistoryProject(projectId);
    return resetEditHistory;
  }, [projectId, resetEditHistory, syncEditHistoryProject]);

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
    if (!projectId || !waveformRevision) return;
    void loadProject(projectId);
  }, [loadProject, projectId, waveformRevision]);

  useEffect(() => {
    if (
      !project ||
      project.id !== projectId ||
      playbackProjectId !== project.id ||
      playbackMode !== 'composition' ||
      playbackDesiredPlaying
    ) {
      return;
    }
    const playback = usePlaybackStore.getState();
    if (!playback.loaded) return;
    setTimelineCursorMs(playback.positionMs, compositionDurationMs(project.clips));
  }, [
    playbackDesiredPlaying,
    playbackMode,
    playbackProjectId,
    project,
    projectId,
    setTimelineCursorMs,
  ]);

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

  const durationMs = compositionDurationMs(project.clips);
  const saving = mutation === 'save';
  const editorBusy = saving || historyBusy || importActive;
  const activePlaybackMode = playbackProjectId === project.id ? playbackMode : null;
  const activePreviewSourceId =
    activePlaybackMode === 'selection'
      ? (requestedPreviewSourceId ?? playbackCurrentClipId)
      : requestedPreviewSourceId;
  const editingClip =
    clipEditor?.mode === 'edit'
      ? (project.clips.find(({ id }) => id === clipEditor.clipId) ?? null)
      : null;
  const namingSource = project.sources.find(({ id }) => id === sourceNameEditor?.sourceId) ?? null;
  const inUseSourceIds = new Set(project.clips.map(({ sourceId }) => sourceId));

  const clearOperationErrors = () => {
    clearError();
    clearPlaybackError();
  };

  const openExport = (projectToExport: SnapCutProject) => {
    setShowExport(true);
    void exportCoordinator.prepare(projectToExport).catch(() => undefined);
  };

  const prepareExport = () => {
    clearOperationErrors();
    if (shouldPromptForProjectName(project)) {
      setRenameReason('first-export');
      return;
    }
    openExport(project);
  };

  const submitProjectRename = async (name: string) => {
    if (!(await renameProject(project.id, name))) return;
    setRenameReason(null);
    const renamed = useProjectStore.getState().activeProject;
    if (renamed?.id === project.id) openExport(renamed);
  };

  const cancelProjectRename = async () => {
    const saved = await updateProject(project.id, completeProjectNamePrompt);
    if (!saved) return;
    setRenameReason(null);
    openExport(saved);
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

  const stopSourcePreview = async (): Promise<boolean> => {
    const playback = usePlaybackStore.getState();
    setRequestedPreviewSourceId(null);
    if (playback.projectId === project.id && playback.mode === 'selection') {
      try {
        await previewCoordinator.releaseProject(project.id);
      } catch {
        return false;
      }
    }
    return true;
  };

  const pauseForInteraction = () => {
    const playback = usePlaybackStore.getState();
    if (playback.projectId !== project.id) return;
    if (playback.mode === 'composition') {
      setTimelineCursorMs(playback.positionMs, durationMs);
      void previewCoordinator.pauseComposition().catch(() => undefined);
    } else if (playback.desiredPlaying || playback.playing || playback.loading) {
      void previewCoordinator.pause().catch(() => undefined);
    }
  };

  const saveClipEdit = async (
    edit: (current: SnapCutProject) => SnapCutProject,
  ): Promise<SnapCutProject | null> => {
    if (historyCommandLocked.current || importActive) return null;
    historyCommandLocked.current = true;
    setHistoryBusy(true);
    let before: SnapCutProject | null = null;
    try {
      await previewCoordinator.releaseProject(project.id);
      const saved = await updateProject(project.id, (current) => {
        before = current;
        return edit(current);
      });
      if (saved && before) useClipEditHistoryStore.getState().record(before);
      if (saved) {
        setTimelineCursorMs(
          Math.min(useEditorStore.getState().timelineCursorMs, compositionDurationMs(saved.clips)),
          compositionDurationMs(saved.clips),
        );
      }
      return saved;
    } catch {
      return null;
    } finally {
      historyCommandLocked.current = false;
      setHistoryBusy(false);
    }
  };

  const runHistoryCommand = async (direction: 'undo' | 'redo') => {
    if (historyCommandLocked.current || importActive) return;
    historyCommandLocked.current = true;
    setHistoryBusy(true);
    let before: SnapCutProject | null = null;
    const history = useClipEditHistoryStore.getState();
    try {
      await previewCoordinator.releaseProject(project.id);
      const saved = await updateProject(project.id, (current) => {
        before = current;
        return direction === 'undo' ? history.previewUndo(current) : history.previewRedo(current);
      });
      if (saved && before) {
        if (direction === 'undo') history.commitUndo(before);
        else history.commitRedo(before);
      }
    } catch {
      // Preview/project stores already expose the stable operation error. The
      // button handlers intentionally fire-and-forget this command, so absorb
      // the rejection here instead of producing an unhandled Debug RedBox.
    } finally {
      historyCommandLocked.current = false;
      setHistoryBusy(false);
    }
  };

  const changeCompositionCursor = (positionMs: number) => {
    setTimelineCursorMs(positionMs, durationMs);
  };

  const finishCompositionCursor = (positionMs: number) => {
    setTimelineCursorMs(positionMs, durationMs);
    const playback = usePlaybackStore.getState();
    if (playback.projectId === project.id && playback.mode === 'composition' && playback.loaded) {
      void previewCoordinator.seek(positionMs, false).catch(() => undefined);
    }
  };

  const closeMedia = () => {
    setShowMedia(false);
    clearOperationErrors();
    void stopSourcePreview();
  };

  const openMedia = () => {
    clearOperationErrors();
    setShowMedia(true);
  };

  const importMedia = () => {
    if (historyCommandLocked.current || importActive) return;
    clearError();
    historyCommandLocked.current = true;
    setHistoryBusy(true);
    void (async () => {
      await previewCoordinator.releaseProject(project.id);
      setRequestedPreviewSourceId(null);
      setShowMedia(false);
      setImportReloadFailed(false);
      setShowImport(true);
      const runtime = getImportRuntime();
      const outcome = await runtime.coordinator.importIntoProject(project.id);
      if (outcome.status === 'cancelled') {
        setShowImport(false);
        resetImportStore();
        return;
      }
      if (outcome.status !== 'imported') return;
      await loadProject(project.id);
      const refreshed = useProjectStore.getState().activeProject;
      const importedSource = refreshed?.sources.find(({ id }) => id === outcome.sourceId);
      if (refreshed?.id === project.id && importedSource) {
        setShowImport(false);
        setShowMedia(true);
        setSourceNameEditor({ sourceId: importedSource.id, reason: 'import' });
        resetImportStore();
      } else {
        setImportReloadFailed(true);
      }
      void runtime.waveformScheduler.whenIdle().then(() => loadProject(project.id));
    })()
      .catch(() => undefined)
      .finally(() => {
        historyCommandLocked.current = false;
        setHistoryBusy(false);
      });
  };

  const closeImport = () => {
    if (importActive) return;
    setShowImport(false);
    setImportReloadFailed(false);
    resetImportStore();
  };

  const previewSource = (source: SnapCutSource) => {
    setRequestedPreviewSourceId(source.id);
    void previewCoordinator.toggleSource(project, source).catch(() => {
      setRequestedPreviewSourceId(null);
    });
  };

  const openAddClip = (sourceId: string | null = project.sources[0]?.id ?? null) => {
    clearOperationErrors();
    if (project.sources.length === 0) {
      setShowMedia(true);
      return;
    }
    void stopSourcePreview();
    setShowMedia(false);
    setClipEditor({ mode: 'add', sourceId });
  };

  const saveClipModal = (draft: ClipRangeDraft) => {
    const state = clipEditor;
    if (!state) return;
    const updatedAt = new Date().toISOString();
    const edit =
      state.mode === 'add'
        ? (current: SnapCutProject) => addClip(current, { id: randomUUID(), ...draft }, updatedAt)
        : (current: SnapCutProject) => updateClip(current, state.clipId, draft, updatedAt);
    void saveClipEdit(edit).then((saved) => {
      if (saved) setClipEditor(null);
    });
  };

  const deleteEditedClip = () => {
    if (clipEditor?.mode !== 'edit') return;
    const clipId = clipEditor.clipId;
    void saveClipEdit((current) => deleteClip(current, clipId, new Date().toISOString())).then(
      (saved) => {
        if (saved) setClipEditor(null);
      },
    );
  };

  const reorderSequentialClip = (clipId: string, destinationIndex: number) => {
    pauseForInteraction();
    void saveClipEdit((current) =>
      reorderClip(current, clipId, destinationIndex, new Date().toISOString()),
    );
  };

  const submitSourceName = (name: string) => {
    if (!sourceNameEditor) return;
    const { sourceId } = sourceNameEditor;
    void (async () => {
      if (!(await stopSourcePreview())) return;
      if (await renameSource(project.id, sourceId, name)) setSourceNameEditor(null);
    })();
  };

  const removeSource = (source: SnapCutSource) => {
    setDeletingSourceId(source.id);
    void (async () => {
      if (!(await stopSourcePreview())) return;
      const deleted = await deleteSource(project.id, source.id);
      if (!deleted) return;
      useClipEditHistoryStore.getState().clearProjectHistory(project.id);
      if (sourceNameEditor?.sourceId === source.id) setSourceNameEditor(null);
    })().finally(() => setDeletingSourceId(null));
  };

  // Opening Media clears stale playback errors first. If native preview fails
  // before beginSession assigns a project id, the resulting error still belongs
  // to this visible Media operation.
  const currentPlaybackError =
    playbackError && (playbackProjectId === project.id || showMedia) ? playbackError : null;
  const modalOperationError = currentPlaybackError ?? error;
  const dismissModalOperationError = currentPlaybackError ? clearPlaybackError : clearError;
  const nativeOperationModalActive =
    showMedia || clipEditor !== null || namingSource !== null || renameReason !== null;
  const editorError = !nativeOperationModalActive
    ? currentPlaybackError
      ? { message: currentPlaybackError, onDismiss: clearPlaybackError }
      : error
        ? { message: error, onDismiss: clearError }
        : null
    : null;

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={copy.editor.backAction}
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Text accessibilityElementsHidden style={styles.backIcon}>
              {'\u2039'}
            </Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.projectTitle}>
            {project.name}
          </Text>
          <Pressable
            accessibilityLabel={copy.editor.addMediaAction}
            accessibilityRole="button"
            accessibilityState={{ disabled: editorBusy }}
            disabled={editorBusy}
            onPress={openMedia}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
              editorBusy && styles.disabledIconButton,
            ]}
            testID="open-media-library"
          >
            <Text accessibilityElementsHidden style={styles.addMediaIcon}>
              +
            </Text>
          </Pressable>
          <Pressable
            accessibilityHint={
              project.clips.length === 0 ? copy.editor.exportDisabledHint : copy.editor.exportHint
            }
            accessibilityLabel={copy.editor.exportAction}
            accessibilityRole="button"
            accessibilityState={{ disabled: project.clips.length === 0 || editorBusy }}
            disabled={project.clips.length === 0 || editorBusy}
            onPress={prepareExport}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
              (project.clips.length === 0 || editorBusy) && styles.disabledIconButton,
            ]}
            testID="open-export"
          >
            <Text accessibilityElementsHidden style={styles.exportIcon}>
              EXP
            </Text>
          </Pressable>
        </View>

        <LiveCompositionWaveform
          clips={project.clips}
          disabled={editorBusy}
          fallbackCursorMs={timelineCursorMs}
          onScrubChange={changeCompositionCursor}
          onScrubEnd={finishCompositionCursor}
          onScrubStart={pauseForInteraction}
          projectId={project.id}
          sources={project.sources}
          waveformsBySourceId={waveformsBySourceId}
        />

        <View style={styles.transport}>
          <LivePlaybackControls
            available={previewAvailable}
            canRedo={canRedo && !editorBusy}
            canUndo={canUndo && !editorBusy}
            compositionAvailable={project.clips.length > 0}
            disabled={editorBusy}
            fallbackDurationMs={durationMs}
            fallbackPositionMs={timelineCursorMs}
            onPause={pauseForInteraction}
            onPlay={() =>
              void previewCoordinator
                .playComposition(project, timelineCursorMs)
                .catch(() => undefined)
            }
            onRedo={() => {
              pauseForInteraction();
              void runHistoryCommand('redo');
            }}
            onUndo={() => {
              pauseForInteraction();
              void runHistoryCommand('undo');
            }}
            projectId={project.id}
            unavailableHint={copy.editor.compositionPreviewUnavailable}
          />
        </View>

        <View style={styles.clipsHeader}>
          <Text accessibilityRole="header" style={styles.clipsTitle}>
            Clips
          </Text>
          <Pressable
            accessibilityLabel="Add clip"
            accessibilityRole="button"
            accessibilityState={{ disabled: editorBusy }}
            disabled={editorBusy}
            onPress={() => openAddClip()}
            style={({ pressed }) => [styles.addClipButton, pressed && styles.pressed]}
            testID="add-clip"
          >
            <Text style={styles.addClipLabel}>+ Clip</Text>
          </Pressable>
        </View>

        <SequentialClipList
          clips={project.clips}
          disabled={editorBusy}
          onEdit={(clip: SnapCutClip) => setClipEditor({ mode: 'edit', clipId: clip.id })}
          onInteractionStart={pauseForInteraction}
          onReorder={reorderSequentialClip}
          sources={project.sources}
        />
      </View>

      {editorError ? (
        <View pointerEvents="box-none" style={styles.errorOverlay} testID="editor-error-overlay">
          <ErrorBanner message={editorError.message} onDismiss={editorError.onDismiss} />
        </View>
      ) : null}

      <MediaLibraryModal
        deletingSourceId={deletingSourceId}
        importBusy={importActive}
        inUseSourceIds={inUseSourceIds}
        onAddClip={(source) => openAddClip(source.id)}
        onClose={closeMedia}
        onDelete={removeSource}
        onImport={importMedia}
        onPreview={previewSource}
        onRename={(source) => {
          clearOperationErrors();
          setSourceNameEditor({ sourceId: source.id, reason: 'rename' });
        }}
        onDismissError={dismissModalOperationError}
        operationError={namingSource === null ? modalOperationError : null}
        previewLoading={activePlaybackMode === 'selection' && playbackLoading}
        previewPlaying={activePlaybackMode === 'selection' && playbackPlaying}
        previewSourceId={activePreviewSourceId}
        sources={project.sources}
        visible={showMedia}
      />
      <ClipEditModal
        busy={editorBusy}
        clip={editingClip}
        initialSourceId={clipEditor?.mode === 'add' ? clipEditor.sourceId : null}
        onCancel={() => {
          setClipEditor(null);
          clearOperationErrors();
        }}
        onDelete={editingClip ? deleteEditedClip : undefined}
        onDismissError={dismissModalOperationError}
        onSave={saveClipModal}
        operationError={modalOperationError}
        sources={project.sources}
        visible={clipEditor !== null}
      />
      <SourceNameModal
        busy={mutation === 'rename-source'}
        initialName={namingSource?.displayName ?? ''}
        onCancel={() => {
          setSourceNameEditor(null);
          clearOperationErrors();
        }}
        onDismissError={dismissModalOperationError}
        onSubmit={submitSourceName}
        operationError={modalOperationError}
        title={sourceNameEditor?.reason === 'rename' ? 'Rename Source' : 'Name Source'}
        visible={namingSource !== null}
      />
      <ProjectNameModal
        busy={mutation === 'rename' || (renameReason === 'first-export' && mutation === 'save')}
        initialName={project.name}
        onCancel={() => void cancelProjectRename()}
        onDismissError={dismissModalOperationError}
        onSubmit={(name) => void submitProjectRename(name)}
        operationError={modalOperationError}
        visible={renameReason !== null}
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
        completionCloseVisible={importReloadFailed}
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
    flex: 1,
    paddingTop: spacing.xxs,
    paddingBottom: 0,
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  projectTitle: {
    ...typography.screenTitle,
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: spacing.xxs,
  },
  iconButton: {
    width: minimumTouchTarget,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  disabledIconButton: {
    opacity: 0.42,
  },
  addMediaIcon: {
    color: colors.focus,
    fontSize: 30,
    lineHeight: 32,
  },
  exportIcon: {
    color: colors.focus,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  backIcon: {
    color: colors.focus,
    fontSize: 38,
    lineHeight: 40,
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
  transport: {
    minHeight: 52,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  clipsHeader: {
    minHeight: minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xxs,
  },
  clipsTitle: {
    ...typography.sectionTitle,
  },
  addClipButton: {
    minWidth: 76,
    height: minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  addClipLabel: {
    ...typography.label,
    color: colors.focus,
  },
  errorOverlay: {
    position: 'absolute',
    zIndex: 40,
    top: 60,
    right: spacing.md,
    left: spacing.md,
  },
});
