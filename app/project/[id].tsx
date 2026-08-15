import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ClipInlineAdjustment,
  EmptyState,
  ErrorBanner,
  ExportModal,
  ImportProgressModal,
  LiveClipActionRail,
  MediaLibraryModal,
  PlaybackControls,
  ProjectNameModal,
  ProjectTimeline,
  TimelineOverview,
  acknowledgedCompositionPausePosition,
  editorWorkspaceLayout,
} from '@/components';
import { colors, copy, layout, minimumTouchTarget, radii, spacing, typography } from '@/constants';
import {
  addFullSourceClip,
  completeProjectNamePrompt,
  compositionDurationMs,
  deleteClip,
  placeClip,
  shouldPromptForProjectName,
  splitClip,
  trimClipEdge,
  updateClip,
  type ClipTrimEdge,
  type FadeDurationMs,
  type SnapCutClip,
  type SnapCutProject,
  type SnapCutSource,
  type TrackId,
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
  useClipEditHistoryStore,
} from '@/stores';
import { canSplitClipAtTimelinePosition, projectContainsCommittedSourceClip } from '@/utils';

function getRouteId(id: string | string[] | undefined): string | null {
  if (typeof id === 'string' && id.length > 0) return id;
  return Array.isArray(id) && id[0] ? id[0] : null;
}

function sourceForClip(project: SnapCutProject, clip: SnapCutClip | null): SnapCutSource | null {
  if (!clip) return null;
  return project.sources.find(({ id }) => id === clip.sourceId) ?? null;
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

function LiveProjectTimeline({
  projectId,
  fallbackCursorMs,
  ...props
}: Omit<ComponentProps<typeof ProjectTimeline>, 'cursorMs'> & {
  projectId: string;
  fallbackCursorMs: number;
}) {
  const cursorMs = useLiveCompositionCursor(projectId, fallbackCursorMs);
  return <ProjectTimeline {...props} cursorMs={cursorMs} />;
}

function LiveTimelineOverview({
  projectId,
  fallbackCursorMs,
  ...props
}: Omit<ComponentProps<typeof TimelineOverview>, 'cursorMs'> & {
  projectId: string;
  fallbackCursorMs: number;
}) {
  const cursorMs = useLiveCompositionCursor(projectId, fallbackCursorMs);
  return <TimelineOverview {...props} cursorMs={cursorMs} />;
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
  const updateProject = useProjectStore((state) => state.updateProject);

  const selectedTrackId = useEditorStore((state) => state.selectedTrackId);
  const selectedClipId = useEditorStore((state) => state.editingClipId);
  const waveformsBySourceId = useEditorStore((state) => state.waveformsBySourceId);
  const timelineCursorMs = useEditorStore((state) => state.timelineCursorMs);
  const timelineVisibleSpanMs = useEditorStore((state) => state.timelineVisibleSpanMs);
  const syncEditorProject = useEditorStore((state) => state.syncProject);
  const selectTrack = useEditorStore((state) => state.selectTrack);
  const beginEditing = useEditorStore((state) => state.beginEditing);
  const cancelEditing = useEditorStore((state) => state.cancelEditing);
  const setTimelineCursorMs = useEditorStore((state) => state.setTimelineCursorMs);
  const setTimelineNavigation = useEditorStore((state) => state.setTimelineNavigation);
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
  const playbackLoaded = usePlaybackStore((state) => state.loaded);
  const playbackPlaying = usePlaybackStore((state) => state.playing);
  const playbackDesiredPlaying = usePlaybackStore((state) => state.desiredPlaying);
  const playbackPausePending = usePlaybackStore((state) => state.pausePending);
  const playbackControlRevision = usePlaybackStore((state) => state.controlRevision);
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
  const [activeAdjustment, setActiveAdjustment] = useState<'volume' | 'fade' | null>(null);
  const [requestedPreviewSourceId, setRequestedPreviewSourceId] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyCommandLocked = useRef(false);
  const timelineInteractionRevision = useRef(0);
  const playbackStartInteractionRevision = useRef(0);
  const pendingPauseAcknowledgement = useRef<{
    interactionRevision: number;
    controlRevision: number;
  } | null>(null);
  const preImportProject = useRef<SnapCutProject | null>(null);
  const recordedImportSourceId = useRef<string | null>(null);
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
      playbackMode !== 'composition'
    ) {
      return;
    }
    if (playbackDesiredPlaying) {
      playbackStartInteractionRevision.current = timelineInteractionRevision.current;
      return;
    }
    if (!playbackLoaded) return;
    if (timelineInteractionRevision.current !== playbackStartInteractionRevision.current) return;
    setTimelineCursorMs(
      usePlaybackStore.getState().positionMs,
      compositionDurationMs(project.clips),
    );
  }, [
    playbackDesiredPlaying,
    playbackLoaded,
    playbackMode,
    playbackProjectId,
    project,
    projectId,
    setTimelineCursorMs,
  ]);

  useEffect(() => {
    const pending = pendingPauseAcknowledgement.current;
    if (!pending || playbackPausePending || playbackControlRevision < pending.controlRevision) {
      return;
    }
    pendingPauseAcknowledgement.current = null;
    if (!project || project.id !== projectId) return;
    const acknowledgedPositionMs = acknowledgedCompositionPausePosition(
      pending.interactionRevision,
      timelineInteractionRevision.current,
      pending.controlRevision,
      project.id,
      usePlaybackStore.getState(),
    );
    if (acknowledgedPositionMs !== null) {
      setTimelineCursorMs(acknowledgedPositionMs, compositionDurationMs(project.clips));
    }
  }, [playbackControlRevision, playbackPausePending, project, projectId, setTimelineCursorMs]);

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
  const selectedClip = project.clips.find(({ id }) => id === selectedClipId) ?? null;
  const saving = mutation === 'save';
  const activePlaybackMode = playbackProjectId === project.id ? playbackMode : null;
  const activePlaybackLoading = playbackProjectId === project.id && playbackLoading;
  const activePlaybackPlaying = playbackProjectId === project.id && playbackPlaying;
  const timelinePlayheadMs = timelineCursorMs;
  const activePreviewSourceId =
    activePlaybackMode === 'selection'
      ? (requestedPreviewSourceId ?? playbackCurrentClipId)
      : requestedPreviewSourceId;

  const openExport = (projectToExport: SnapCutProject) => {
    setShowExport(true);
    void exportCoordinator.prepare(projectToExport).catch(() => undefined);
  };

  const prepareExport = () => {
    if (shouldPromptForProjectName(project)) {
      setRenameReason('first-export');
      return;
    }
    openExport(project);
  };

  const submitRename = async (name: string) => {
    const reason = renameReason;
    if (!(await renameProject(project.id, name))) return;
    setRenameReason(null);
    if (reason === 'first-export') {
      const renamed = useProjectStore.getState().activeProject;
      if (renamed?.id === project.id) openExport(renamed);
    }
  };

  const cancelRename = async () => {
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
      return saved;
    } catch {
      return null;
    } finally {
      historyCommandLocked.current = false;
      setHistoryBusy(false);
    }
  };

  const stopSourcePreview = async () => {
    const playback = usePlaybackStore.getState();
    setRequestedPreviewSourceId(null);
    if (playback.projectId === project.id && playback.mode === 'selection') {
      await previewCoordinator.releaseProject(project.id).catch(() => undefined);
    }
  };

  const closeMedia = () => {
    setShowMedia(false);
    void stopSourcePreview();
  };

  const importMedia = () => {
    if (historyCommandLocked.current || importActive) return;
    historyCommandLocked.current = true;
    setHistoryBusy(true);
    void (async () => {
      try {
        await previewCoordinator.releaseProject(project.id);
      } catch {
        return;
      }
      const runtime = getImportRuntime();
      preImportProject.current = project;
      recordedImportSourceId.current = null;
      setRequestedPreviewSourceId(null);
      setShowMedia(false);
      setImportReloadFailed(false);
      setShowImport(true);
      const outcome = await runtime.coordinator.importIntoProject(project.id, 'track-1');
      if (outcome.status === 'cancelled') {
        preImportProject.current = null;
        setShowImport(false);
        resetImportStore();
        return;
      }
      if (outcome.status !== 'imported') return;
      const reloadCommittedProject = async () => {
        await loadProject(project.id);
        const refreshed = useProjectStore.getState().activeProject;
        const committed =
          refreshed?.id === project.id &&
          projectContainsCommittedSourceClip(refreshed, outcome.sourceId);
        if (
          committed &&
          preImportProject.current &&
          recordedImportSourceId.current !== outcome.sourceId
        ) {
          useClipEditHistoryStore.getState().record(preImportProject.current);
          recordedImportSourceId.current = outcome.sourceId;
          preImportProject.current = null;
        }
        return committed;
      };
      if (await reloadCommittedProject()) {
        setShowImport(false);
        resetImportStore();
      } else {
        setImportReloadFailed(true);
      }
      void runtime.waveformScheduler.whenIdle().then(async () => {
        if (await reloadCommittedProject()) {
          setShowImport(false);
          setImportReloadFailed(false);
          resetImportStore();
        }
      });
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

  const addFullSource = (source: SnapCutSource) => {
    const clipId = randomUUID();
    void stopSourcePreview().then(() =>
      saveClipEdit((current) => addFullSourceClip(current, source.id, clipId, 'track-1')).then(
        (saved) => {
          if (saved) setShowMedia(false);
        },
      ),
    );
  };

  const selectTimelineClip = (clipId: string) => {
    const clip = project.clips.find(({ id }) => id === clipId);
    const source = sourceForClip(project, clip ?? null);
    if (!clip || !source) return;
    if (clipId !== selectedClipId) setActiveAdjustment(null);
    beginEditing(clip, source);
    selectTrack(clip.trackId);
  };

  const deleteSelectedClip = (clipId: string) => {
    void saveClipEdit((current) => deleteClip(current, clipId)).then((saved) => {
      if (!saved) return;
      cancelEditing();
    });
  };

  const splitSelectedClip = (clipId: string, timelinePositionMs: number) => {
    const clip = project.clips.find(({ id }) => id === clipId);
    if (!clip || !canSplitClipAtTimelinePosition(clip, timelinePositionMs)) return;
    const sourceSplitMs = clip.startMs + timelinePositionMs - clip.timelineStartMs;
    void saveClipEdit((current) => splitClip(current, clipId, sourceSplitMs, randomUUID()));
  };

  const moveTimelineClip = (
    clipId: string,
    trackId: TrackId,
    timelineStartMs: number,
  ): Promise<SnapCutProject | null> =>
    saveClipEdit((current) => placeClip(current, clipId, timelineStartMs, trackId));

  const trimTimelineClip = (
    clipId: string,
    edge: ClipTrimEdge,
    requestedSourceMs: number,
  ): Promise<SnapCutProject | null> =>
    saveClipEdit((current) => trimClipEdge(current, clipId, edge, requestedSourceMs));

  const saveVolume = async (gain: number): Promise<boolean> => {
    if (!selectedClip) return false;
    return (
      (await saveClipEdit((current) => updateClip(current, selectedClip.id, { gain }))) !== null
    );
  };

  const saveFades = async (
    fadeInMs: FadeDurationMs,
    fadeOutMs: FadeDurationMs,
  ): Promise<boolean> => {
    if (!selectedClip) return false;
    return (
      (await saveClipEdit((current) =>
        updateClip(current, selectedClip.id, { fadeInMs, fadeOutMs }),
      )) !== null
    );
  };

  const runHistoryCommand = async (direction: 'undo' | 'redo') => {
    if (historyCommandLocked.current) return;
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
      // PreviewCoordinator already exposes a safe, user-facing playback error.
    } finally {
      historyCommandLocked.current = false;
      setHistoryBusy(false);
    }
  };

  const pauseForInteraction = () => {
    const playback = usePlaybackStore.getState();
    if (playback.projectId !== project.id) return;
    if (playback.mode === 'composition') {
      const requestedInteractionRevision = ++timelineInteractionRevision.current;
      setTimelineCursorMs(playback.positionMs, durationMs);
      const pausePromise = previewCoordinator.pauseComposition();
      const requestedControlRevision = usePlaybackStore.getState().controlRevision;
      pendingPauseAcknowledgement.current = {
        interactionRevision: requestedInteractionRevision,
        controlRevision: requestedControlRevision,
      };
      void pausePromise.catch(() => {
        if (pendingPauseAcknowledgement.current?.controlRevision === requestedControlRevision) {
          pendingPauseAcknowledgement.current = null;
        }
      });
      return;
    }
    if (playback.desiredPlaying || playback.playing || playback.loading) {
      void previewCoordinator.pause().catch(() => undefined);
    }
  };

  const changeTimelineScrub = (positionMs: number) => {
    timelineInteractionRevision.current += 1;
    setTimelineCursorMs(positionMs, durationMs);
  };

  const finishTimelineScrub = (positionMs: number) => {
    timelineInteractionRevision.current += 1;
    setTimelineCursorMs(positionMs, durationMs);
    const playback = usePlaybackStore.getState();
    if (playback.projectId === project.id && playback.mode === 'composition' && playback.loaded) {
      void previewCoordinator.seek(positionMs, false).catch(() => undefined);
    }
  };

  const changeOverviewNavigation = (cursorMs: number, visibleSpanMs: number) => {
    timelineInteractionRevision.current += 1;
    setTimelineNavigation(cursorMs, visibleSpanMs, durationMs);
  };

  const finishOverviewChange = (cursorMs: number, visibleSpanMs: number) => {
    timelineInteractionRevision.current += 1;
    setTimelineNavigation(cursorMs, visibleSpanMs, durationMs);
    const playback = usePlaybackStore.getState();
    if (playback.projectId === project.id && playback.mode === 'composition' && playback.loaded) {
      void previewCoordinator.seek(cursorMs, false).catch(() => undefined);
    }
  };

  const splitAtCurrentCursor = () => {
    if (!selectedClip) return;
    const playback = usePlaybackStore.getState();
    const positionMs =
      playback.projectId === project.id &&
      playback.mode === 'composition' &&
      (playback.desiredPlaying || playback.playing)
        ? playback.positionMs
        : useEditorStore.getState().timelineCursorMs;
    pauseForInteraction();
    setActiveAdjustment(null);
    splitSelectedClip(selectedClip.id, positionMs);
  };

  const editorError =
    playbackError && playbackProjectId === project.id
      ? { message: playbackError, onDismiss: clearPlaybackError }
      : error
        ? { message: error, onDismiss: clearError }
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
            <Text accessibilityElementsHidden style={styles.hiddenBackIcon}>
              ‹
            </Text>
            <Text accessibilityElementsHidden style={styles.backIcon}>
              {'\u2039'}
            </Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.projectTitle}>
            {project.name}
          </Text>
          <Pressable
            accessibilityLabel="Add media"
            accessibilityRole="button"
            accessibilityState={{ disabled: saving || historyBusy || importActive }}
            disabled={saving || historyBusy || importActive}
            onPress={() => setShowMedia(true)}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
              (saving || historyBusy || importActive) && styles.disabledIconButton,
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
            accessibilityState={{
              disabled: project.clips.length === 0 || saving || historyBusy || importActive,
            }}
            disabled={project.clips.length === 0 || saving || historyBusy || importActive}
            onPress={prepareExport}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
              (project.clips.length === 0 || saving || historyBusy || importActive) &&
                styles.disabledIconButton,
            ]}
            testID="open-export"
          >
            <Text accessibilityElementsHidden style={styles.exportIcon}>
              EXP
            </Text>
          </Pressable>
        </View>

        <View style={styles.transport}>
          <LivePlaybackControls
            available={previewAvailable}
            canRedo={canRedo && !historyBusy && !saving}
            canUndo={canUndo && !historyBusy && !saving}
            compositionAvailable={project.clips.length > 0}
            disabled={saving || historyBusy || importActive}
            fallbackDurationMs={durationMs}
            fallbackPositionMs={timelinePlayheadMs}
            onPause={pauseForInteraction}
            onPlay={() =>
              void previewCoordinator
                .playComposition(project, timelinePlayheadMs)
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

        <LiveProjectTimeline
          clips={project.clips}
          fallbackCursorMs={timelinePlayheadMs}
          onEditStart={pauseForInteraction}
          onMoveClip={moveTimelineClip}
          onScrubChange={changeTimelineScrub}
          onScrubEnd={finishTimelineScrub}
          onScrubStart={pauseForInteraction}
          onSelectClip={selectTimelineClip}
          onSelectTrack={selectTrack}
          onTrimClipEdge={trimTimelineClip}
          projectId={project.id}
          selectedClipId={selectedClipId}
          selectedTrackId={selectedTrackId}
          sources={project.sources}
          visibleSpanMs={timelineVisibleSpanMs}
          waveformsBySourceId={waveformsBySourceId}
        />

        <LiveTimelineOverview
          clips={project.clips}
          disabled={saving || historyBusy || importActive}
          durationMs={durationMs}
          fallbackCursorMs={timelinePlayheadMs}
          onChange={changeOverviewNavigation}
          onChangeEnd={finishOverviewChange}
          onInteractionStart={pauseForInteraction}
          projectId={project.id}
          visibleSpanMs={timelineVisibleSpanMs}
        />

        <LiveClipActionRail
          disabled={saving || historyBusy || importActive}
          fallbackCursorMs={timelinePlayheadMs}
          onDelete={() => {
            if (!selectedClip) return;
            pauseForInteraction();
            setActiveAdjustment(null);
            deleteSelectedClip(selectedClip.id);
          }}
          onFade={() => {
            pauseForInteraction();
            setActiveAdjustment((current) => (current === 'fade' ? null : 'fade'));
          }}
          onSplit={splitAtCurrentCursor}
          onVolume={() => {
            pauseForInteraction();
            setActiveAdjustment((current) => (current === 'volume' ? null : 'volume'));
          }}
          projectId={project.id}
          selectedClip={selectedClip}
        />
        <ClipInlineAdjustment
          busy={saving || historyBusy || importActive}
          clip={selectedClip}
          mode={activeAdjustment}
          onCommitFades={saveFades}
          onCommitVolume={saveVolume}
          onInteractionStart={pauseForInteraction}
        />
      </View>

      {editorError ? (
        <View pointerEvents="box-none" style={styles.errorOverlay} testID="editor-error-overlay">
          <ErrorBanner message={editorError.message} onDismiss={editorError.onDismiss} />
        </View>
      ) : null}

      <MediaLibraryModal
        importBusy={importActive}
        onAddFull={addFullSource}
        onClose={closeMedia}
        onImport={importMedia}
        onPreview={previewSource}
        previewLoading={activePlaybackMode === 'selection' && activePlaybackLoading}
        previewPlaying={activePlaybackMode === 'selection' && activePlaybackPlaying}
        previewSourceId={activePreviewSourceId}
        sources={project.sources}
        visible={showMedia}
      />
      <ProjectNameModal
        busy={mutation === 'rename' || (renameReason === 'first-export' && mutation === 'save')}
        initialName={project.name}
        onCancel={() => void cancelRename()}
        onSubmit={(name) => void submitRename(name)}
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
    paddingTop: editorWorkspaceLayout.contentVerticalPadding,
    paddingBottom: editorWorkspaceLayout.contentVerticalPadding,
  },
  header: {
    height: editorWorkspaceLayout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: editorWorkspaceLayout.sectionGap,
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
  hiddenBackIcon: {
    display: 'none',
  },
  pressed: {
    backgroundColor: colors.accentTranslucent,
  },
  transport: {
    ...layout.card,
    height: editorWorkspaceLayout.transportHeight,
    padding: spacing.xxs,
    marginBottom: editorWorkspaceLayout.sectionGap,
  },
  errorOverlay: {
    position: 'absolute',
    zIndex: 40,
    top: editorWorkspaceLayout.headerHeight + editorWorkspaceLayout.sectionGap,
    right: spacing.md,
    left: spacing.md,
  },
});
