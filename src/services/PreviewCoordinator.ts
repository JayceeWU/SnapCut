import { AppState, type AppStateStatus } from 'react-native';
import { randomUUID } from 'expo-crypto';

import {
  COMPARISON_PREVIEW_CONTEXT_MS,
  compositionDurationMs,
  validateSourceComparisonBookmark,
} from '@/domain';
import type { SnapCutClip, SnapCutProject, SnapCutSource } from '@/domain';
import { diagnosticLog } from '@/diagnostics';
import SnapCutMedia from '@/native/SnapCutMedia';
import type {
  NativeErrorEvent,
  NativePreviewClip,
  PlaybackStatusEvent,
  SnapCutMediaApi,
  SnapCutMediaEventApi,
  SnapCutMediaSubscription,
} from '@/native';
import { storageLayout } from '@/repositories';
import { usePlaybackStore, type PreviewMode } from '@/stores/playbackStore';

export type PreviewCoordinatorErrorCode =
  | 'PREVIEW_UNAVAILABLE'
  | 'EMPTY_COMPOSITION'
  | 'MISSING_COMMITTED_SOURCE'
  | 'PREVIEW_COMMAND_FAILED';

export class PreviewCoordinatorError extends Error {
  constructor(
    readonly code: PreviewCoordinatorErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PreviewCoordinatorError';
  }
}

export type PreviewMediaPort = Pick<
  SnapCutMediaApi,
  | 'getHealth'
  | 'getCodecBuildInfo'
  | 'loadSelectionPreview'
  | 'loadCompositionPreview'
  | 'playPreview'
  | 'pausePreview'
  | 'seekPreview'
  | 'releasePreview'
> &
  Pick<SnapCutMediaEventApi, 'addEventListener'>;

export interface CommittedSourceResolverPort {
  resolveSourceAudioUri(project: SnapCutProject, source: SnapCutSource): string;
}

interface AppStateSubscription {
  remove(): void;
}

export interface PreviewAppStatePort {
  readonly currentState: AppStateStatus;
  addEventListener(
    eventName: 'change',
    listener: (state: AppStateStatus) => void,
  ): AppStateSubscription;
}

export class PrivateSourceResolver implements CommittedSourceResolverPort {
  resolveSourceAudioUri(project: SnapCutProject, source: SnapCutSource): string {
    const projectMetadataUri = storageLayout.projectMetadataUri(project.id);
    const audioFileUri = storageLayout.sourceAudioUri(
      project.id,
      source.id,
      source.privateAudioFileName,
    );
    if (
      !storageLayout.isInsideProjects(audioFileUri) ||
      !storageLayout.fileSystem.fileExists(projectMetadataUri) ||
      !storageLayout.fileSystem.fileExists(audioFileUri)
    ) {
      throw new PreviewCoordinatorError(
        'MISSING_COMMITTED_SOURCE',
        'Preview requires a committed application-private source file.',
      );
    }
    return audioFileUri;
  }
}

export interface PreviewCoordinatorOptions {
  media?: PreviewMediaPort;
  sourceResolver?: CommittedSourceResolverPort;
  appState?: PreviewAppStatePort;
  idFactory?: () => string;
  onDiagnostic?: (entry: PreviewDiagnostic) => void;
}

export interface PreviewDiagnostic {
  operation: 'preview';
  projectId: string;
  jobId: string;
  generation: number;
  stage: string;
  code: string;
}

interface ActivePreview {
  projectId: string;
  playbackSessionId: string;
  generation: number;
  mode: PreviewMode;
  key: string;
  clipIds: string[];
  controlRevision: number;
  durationMs: number;
  nativeRegistered: boolean;
  loadResolved: boolean;
  pendingPlayRevision: number | null;
  pendingSeek: {
    positionMs: number;
    resumeAfterSeek: boolean;
    controlRevision: number;
  } | null;
  lastSequence: number;
}

const commandRequest = (active: ActivePreview) => ({
  playbackSessionId: active.playbackSessionId,
  generation: active.generation,
  controlRevision: active.controlRevision,
});

const clipKey = (clip: SnapCutClip): string =>
  [clip.id, clip.sourceId, clip.startMs, clip.endMs].join(':');

const selectionKey = (projectId: string, clip: SnapCutClip): string =>
  `selection:${projectId}:${clipKey(clip)}`;

const comparisonKey = (
  projectId: string,
  sourceId: string,
  firstMs: number,
  secondMs: number,
): string => `comparison:${projectId}:${sourceId}:${firstMs}:${secondMs}`;

const comparisonResultKey = (
  projectId: string,
  sourceId: string,
  firstMs: number,
  secondMs: number,
): string => `comparison-result:${projectId}:${sourceId}:${firstMs}:${secondMs}`;

const COMPARISON_BEFORE_CLIP_ID = '00000000-0000-4000-8000-000000000001';
const COMPARISON_AFTER_CLIP_ID = '00000000-0000-4000-8000-000000000002';
const COMPARISON_RESULT_BEFORE_CLIP_ID = '00000000-0000-4000-8000-000000000003';
const COMPARISON_RESULT_AFTER_CLIP_ID = '00000000-0000-4000-8000-000000000004';

const compositionKey = (project: SnapCutProject): string =>
  `composition:${project.id}:${project.clips.map(clipKey).join('|')}:${project.crossfades
    .map(
      ({ id, leftClipId, rightClipId, durationMs }) =>
        `${id}:${leftClipId}:${rightClipId}:${durationMs}`,
    )
    .join('|')}`;

const clampInteger = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(Math.round(Number.isFinite(value) ? value : 0), minimum), maximum);

/**
 * Keeps the native two-track engine private while adapting persisted ordered
 * clips and optional adjacent crossfades to a gap-free timeline.
 */
export function buildNativeSequentialClips(
  project: SnapCutProject,
  clips: readonly SnapCutClip[],
  sourceResolver: CommittedSourceResolverPort,
): NativePreviewClip[] {
  let timelineStartMs = 0;
  let previousTrack: 'track-1' | 'track-2' = 'track-1';
  return clips.map((clip) => {
    const source = project.sources.find(({ id }) => id === clip.sourceId);
    if (!source) {
      throw new PreviewCoordinatorError(
        'MISSING_COMMITTED_SOURCE',
        `Clip source is not committed in project ${project.id}.`,
      );
    }
    const incoming = project.crossfades.find(({ rightClipId }) => rightClipId === clip.id);
    const outgoing = project.crossfades.find(({ leftClipId }) => leftClipId === clip.id);
    const incomingHalfMs = (incoming?.durationMs ?? 0) / 2;
    const outgoingHalfMs = (outgoing?.durationMs ?? 0) / 2;
    const durationMs = clip.endMs - clip.startMs;
    const timelineEndMs = timelineStartMs + durationMs;
    if (!Number.isSafeInteger(timelineEndMs)) {
      throw new PreviewCoordinatorError(
        'PREVIEW_COMMAND_FAILED',
        'Composition duration exceeds the supported range.',
      );
    }
    const overlapsPrevious = incoming !== undefined;
    const trackId = overlapsPrevious
      ? previousTrack === 'track-1'
        ? 'track-2'
        : 'track-1'
      : 'track-1';
    const nativeClip: NativePreviewClip = {
      clipId: clip.id,
      sourceId: source.id,
      audioFileUri: sourceResolver.resolveSourceAudioUri(project, source),
      startMs: clip.startMs - incomingHalfMs,
      endMs: clip.endMs + outgoingHalfMs,
      trackId,
      timelineStartMs: timelineStartMs - incomingHalfMs,
      gain: 1,
      fadeInMs: incoming?.durationMs ?? 0,
      fadeOutMs: outgoing?.durationMs ?? 0,
    };
    timelineStartMs = timelineEndMs;
    previousTrack = trackId;
    return nativeClip;
  });
}

function buildComparisonPreviewClips(
  project: SnapCutProject,
  source: SnapCutSource,
  firstMs: number,
  secondMs: number,
): SnapCutClip[] {
  const bookmark = validateSourceComparisonBookmark(project, source.id, firstMs, secondMs);
  return [
    {
      id: COMPARISON_BEFORE_CLIP_ID,
      sourceId: source.id,
      startMs: Math.max(0, bookmark.firstMs - COMPARISON_PREVIEW_CONTEXT_MS),
      endMs: bookmark.firstMs,
    },
    {
      id: COMPARISON_AFTER_CLIP_ID,
      sourceId: source.id,
      startMs: bookmark.secondMs,
      endMs: Math.min(source.durationMs, bookmark.secondMs + COMPARISON_PREVIEW_CONTEXT_MS),
    },
  ];
}

function buildComparisonResultClips(
  project: SnapCutProject,
  source: SnapCutSource,
  firstMs: number,
  secondMs: number,
): SnapCutClip[] {
  const bookmark = validateSourceComparisonBookmark(project, source.id, firstMs, secondMs);
  return [
    {
      id: COMPARISON_RESULT_BEFORE_CLIP_ID,
      sourceId: source.id,
      startMs: 0,
      endMs: bookmark.firstMs,
    },
    {
      id: COMPARISON_RESULT_AFTER_CLIP_ID,
      sourceId: source.id,
      startMs: bookmark.secondMs,
      endMs: source.durationMs,
    },
  ];
}

export class PreviewCoordinator {
  private readonly media: PreviewMediaPort;
  private readonly sourceResolver: CommittedSourceResolverPort;
  private readonly appState: PreviewAppStatePort;
  private readonly idFactory: () => string;
  private readonly onDiagnostic: (entry: PreviewDiagnostic) => void;
  private subscriptions: SnapCutMediaSubscription[] = [];
  private appStateSubscription: AppStateSubscription | null = null;
  private active: ActivePreview | null = null;
  private generation = 0;
  private operationToken = 0;
  private started = false;
  private appIsActive: boolean;

  constructor(options: PreviewCoordinatorOptions = {}) {
    this.media = options.media ?? SnapCutMedia;
    this.sourceResolver = options.sourceResolver ?? new PrivateSourceResolver();
    this.appState = options.appState ?? AppState;
    this.idFactory = options.idFactory ?? randomUUID;
    this.onDiagnostic =
      options.onDiagnostic ??
      ((entry) => {
        void diagnosticLog.append('error', 'preview.failed', entry);
      });
    this.appIsActive = this.appState.currentState === 'active';
  }

  start(): boolean {
    if (this.started) return usePlaybackStore.getState().available;
    this.started = true;

    try {
      const health = this.media.getHealth();
      const codecs = this.media.getCodecBuildInfo();
      const available = health.ready && health.mediaPipelineAvailable && codecs.media3.available;
      usePlaybackStore.getState().setAvailable(available);
      if (available) {
        this.subscriptions = [
          this.media.addEventListener('onPlaybackStatus', (event) => this.handleStatus(event)),
          this.media.addEventListener('onNativeError', (event) => this.handleNativeError(event)),
        ];
      }
    } catch {
      usePlaybackStore.getState().setAvailable(false);
    }

    this.appStateSubscription = this.appState.addEventListener('change', (state) => {
      this.appIsActive = state === 'active';
      if (!this.appIsActive) {
        usePlaybackStore.getState().markBackgroundPaused();
        void this.pause().catch(() => undefined);
      }
    });
    return usePlaybackStore.getState().available;
  }

  stop(): void {
    if (!this.started) return;
    void this.release().catch(() => undefined);
    this.subscriptions.forEach((subscription) => subscription.remove());
    this.subscriptions = [];
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.started = false;
    usePlaybackStore.getState().setAvailable(false);
  }

  async loadSelection(project: SnapCutProject, clipInput: SnapCutClip): Promise<boolean> {
    return this.load('selection', project, [clipInput], selectionKey(project.id, clipInput), {
      operationToken: ++this.operationToken,
      desiredPlaying: false,
      initialControlRevision: 0,
    });
  }

  async loadComposition(project: SnapCutProject): Promise<boolean> {
    if (project.clips.length === 0) {
      throw new PreviewCoordinatorError('EMPTY_COMPOSITION', 'Composition preview needs a clip.');
    }
    return this.load('composition', project, project.clips, compositionKey(project), {
      operationToken: ++this.operationToken,
      desiredPlaying: false,
      initialControlRevision: 0,
    });
  }

  async toggleSelection(project: SnapCutProject, clip: SnapCutClip): Promise<void> {
    const key = selectionKey(project.id, clip);
    if (this.active?.key === key) {
      const state = usePlaybackStore.getState();
      if (state.desiredPlaying || state.playing) await this.pause();
      else await this.playSelection(project, clip);
      return;
    }
    await this.playSelection(project, clip);
  }

  async toggleSource(project: SnapCutProject, source: SnapCutSource): Promise<void> {
    await this.toggleSelection(project, {
      id: source.id,
      sourceId: source.id,
      startMs: 0,
      endMs: source.durationMs,
    });
  }

  async toggleSourceAt(
    project: SnapCutProject,
    source: SnapCutSource,
    startPositionMs: number,
  ): Promise<void> {
    const clip: SnapCutClip = {
      id: source.id,
      sourceId: source.id,
      startMs: 0,
      endMs: source.durationMs,
    };
    const key = selectionKey(project.id, clip);
    if (this.active?.key === key) {
      const state = usePlaybackStore.getState();
      if (state.desiredPlaying || state.playing) await this.pause();
      else await this.playSelection(project, clip, startPositionMs);
      return;
    }
    await this.playSelection(project, clip, startPositionMs);
  }

  async toggleComparison(
    project: SnapCutProject,
    source: SnapCutSource,
    firstMs: number,
    secondMs: number,
  ): Promise<void> {
    const key = comparisonKey(project.id, source.id, firstMs, secondMs);
    if (this.active?.key === key) {
      const state = usePlaybackStore.getState();
      if (state.desiredPlaying || state.playing) await this.pause();
      else await this.playComparison(project, source, firstMs, secondMs);
      return;
    }
    await this.playComparison(project, source, firstMs, secondMs);
  }

  async playComparison(
    project: SnapCutProject,
    source: SnapCutSource,
    firstMs: number,
    secondMs: number,
  ): Promise<void> {
    const clips = buildComparisonPreviewClips(project, source, firstMs, secondMs);
    const key = comparisonKey(project.id, source.id, firstMs, secondMs);
    const operationToken = ++this.operationToken;
    let active = this.active?.key === key ? this.active : null;
    if (active === null) {
      const loaded = await this.load('selection', project, clips, key, {
        operationToken,
        desiredPlaying: true,
        initialControlRevision: 1,
      });
      if (!loaded) return;
      active = this.active;
    } else {
      active.controlRevision += 1;
      usePlaybackStore.getState().requestPlay(active.controlRevision, 0);
    }
    if (!active || !this.isCurrentPlayIntent(active, operationToken)) return;
    if (!active.loadResolved) {
      active.pendingSeek = {
        positionMs: 0,
        resumeAfterSeek: false,
        controlRevision: active.controlRevision,
      };
      active.pendingPlayRevision = active.controlRevision;
      return;
    }
    await this.issueSeek(active, 0, false, operationToken);
    if (this.isCurrentPlayIntent(active, operationToken)) {
      await this.issuePlay(active, operationToken);
    }
  }

  async toggleComparisonResult(
    project: SnapCutProject,
    source: SnapCutSource,
    firstMs: number,
    secondMs: number,
    startPositionMs: number,
  ): Promise<void> {
    const key = comparisonResultKey(project.id, source.id, firstMs, secondMs);
    if (this.active?.key === key) {
      const state = usePlaybackStore.getState();
      if (state.desiredPlaying || state.playing) await this.pause();
      else await this.playComparisonResult(project, source, firstMs, secondMs, startPositionMs);
      return;
    }
    await this.playComparisonResult(project, source, firstMs, secondMs, startPositionMs);
  }

  async playComparisonResult(
    project: SnapCutProject,
    source: SnapCutSource,
    firstMs: number,
    secondMs: number,
    startPositionMs: number,
  ): Promise<void> {
    const clips = buildComparisonResultClips(project, source, firstMs, secondMs);
    const key = comparisonResultKey(project.id, source.id, firstMs, secondMs);
    const durationMs = compositionDurationMs(clips);
    const requestedStart = clampInteger(startPositionMs, 0, durationMs);
    const operationToken = ++this.operationToken;
    let active = this.active?.key === key ? this.active : null;
    if (active === null) {
      const loaded = await this.load('selection', project, clips, key, {
        operationToken,
        desiredPlaying: true,
        initialControlRevision: 1,
      });
      if (!loaded) return;
      active = this.active;
    } else {
      active.controlRevision += 1;
      usePlaybackStore.getState().requestPlay(active.controlRevision);
    }
    if (!active || !this.isCurrentPlayIntent(active, operationToken)) return;
    if (!active.loadResolved) {
      active.pendingSeek = {
        positionMs: requestedStart,
        resumeAfterSeek: false,
        controlRevision: active.controlRevision,
      };
      active.pendingPlayRevision = active.controlRevision;
      return;
    }
    if (requestedStart !== usePlaybackStore.getState().positionMs) {
      await this.issueSeek(active, requestedStart, false, operationToken);
    }
    if (this.isCurrentPlayIntent(active, operationToken)) {
      await this.issuePlay(active, operationToken);
    }
  }

  async toggleComposition(project: SnapCutProject, startPositionMs?: number): Promise<void> {
    const key = compositionKey(project);
    if (this.active?.key === key) {
      const state = usePlaybackStore.getState();
      if (state.desiredPlaying || state.playing) await this.pauseComposition();
      else await this.playComposition(project, startPositionMs);
      return;
    }
    await this.playComposition(project, startPositionMs);
  }

  async playSelection(
    project: SnapCutProject,
    clipInput: SnapCutClip,
    startPositionMs?: number,
  ): Promise<void> {
    const clip = clipInput;
    const key = selectionKey(project.id, clipInput);
    const requestedStart =
      startPositionMs === undefined
        ? undefined
        : clampInteger(startPositionMs, 0, clip.endMs - clip.startMs);
    const operationToken = ++this.operationToken;
    let active = this.active?.key === key ? this.active : null;
    if (active === null) {
      const loaded = await this.load('selection', project, [clip], key, {
        operationToken,
        desiredPlaying: true,
        initialControlRevision: 1,
      });
      if (!loaded) return;
      active = this.active;
    } else {
      active.controlRevision += 1;
      usePlaybackStore.getState().requestPlay(active.controlRevision, requestedStart);
    }
    if (!active || !this.isCurrentPlayIntent(active, operationToken)) return;
    if (!active.loadResolved) {
      if (requestedStart !== undefined) {
        active.pendingSeek = {
          positionMs: requestedStart,
          resumeAfterSeek: false,
          controlRevision: active.controlRevision,
        };
      }
      active.pendingPlayRevision = active.controlRevision;
      return;
    }
    if (requestedStart !== undefined && requestedStart !== usePlaybackStore.getState().positionMs) {
      await this.issueSeek(active, requestedStart, false, operationToken);
    }
    if (!this.isCurrentPlayIntent(active, operationToken)) return;
    await this.issuePlay(active, operationToken);
  }

  async playComposition(project: SnapCutProject, startPositionMs?: number): Promise<void> {
    if (project.clips.length === 0) {
      throw new PreviewCoordinatorError('EMPTY_COMPOSITION', 'Composition preview needs a clip.');
    }
    const clips = project.clips;
    const key = compositionKey(project);
    const durationMs = compositionDurationMs(clips);
    const requestedStart =
      startPositionMs === undefined
        ? undefined
        : clampInteger(startPositionMs, 0, Math.max(0, durationMs));
    const operationToken = ++this.operationToken;
    let active = this.active?.key === key ? this.active : null;
    if (active === null) {
      const loaded = await this.load('composition', project, clips, key, {
        operationToken,
        desiredPlaying: true,
        initialControlRevision: 1,
      });
      if (!loaded) return;
      active = this.active;
    } else {
      active.controlRevision += 1;
      usePlaybackStore.getState().requestPlay(active.controlRevision);
    }
    if (!active || !this.isCurrentPlayIntent(active, operationToken)) return;
    if (!active.loadResolved) {
      if (requestedStart !== undefined) {
        active.pendingSeek = {
          positionMs: requestedStart,
          resumeAfterSeek: false,
          controlRevision: active.controlRevision,
        };
      }
      active.pendingPlayRevision = active.controlRevision;
      return;
    }
    if (requestedStart !== undefined && requestedStart !== usePlaybackStore.getState().positionMs) {
      await this.issueSeek(active, requestedStart, false, operationToken);
    }
    if (this.isCurrentPlayIntent(active, operationToken)) {
      await this.issuePlay(active, operationToken);
    }
  }

  async pauseComposition(): Promise<void> {
    if (this.active?.mode !== 'composition') return;
    await this.pause();
  }

  async play(): Promise<void> {
    if (!this.appIsActive) {
      usePlaybackStore.getState().markBackgroundPaused();
      return;
    }
    const active = this.requireActive();
    const operationToken = ++this.operationToken;
    active.controlRevision += 1;
    usePlaybackStore.getState().requestPlay(active.controlRevision);
    if (!active.loadResolved) {
      active.pendingPlayRevision = active.controlRevision;
      return;
    }
    await this.issuePlay(active, operationToken);
  }

  private async issuePlay(active: ActivePreview, operationToken: number): Promise<void> {
    if (!this.isCurrentPlayIntent(active, operationToken)) return;
    try {
      await this.media.playPreview(commandRequest(active));
    } catch (error) {
      if (this.isCurrentIntent(active, operationToken)) this.failActive(active, error);
    }
  }

  async pause(): Promise<void> {
    const active = this.active;
    if (!active) {
      usePlaybackStore.getState().markBackgroundPaused();
      return;
    }
    const operationToken = ++this.operationToken;
    active.controlRevision += 1;
    active.pendingPlayRevision = null;
    active.pendingSeek = null;
    usePlaybackStore.getState().requestPause(active.controlRevision);
    if (!active.nativeRegistered) {
      this.active = null;
      usePlaybackStore.getState().cancelSession(active.controlRevision);
      return;
    }
    try {
      await this.media.pausePreview(commandRequest(active));
    } catch (error) {
      if (!this.isCurrentIntent(active, operationToken)) return;
      await this.failAndReleaseAfterPause(active, error);
    }
  }

  async seek(positionMs: number, resumeAfterSeek = false): Promise<void> {
    const active = this.requireActive();
    const operationToken = ++this.operationToken;
    active.controlRevision += 1;
    const safePositionMs = clampInteger(positionMs, 0, Math.max(0, active.durationMs));
    if (resumeAfterSeek) usePlaybackStore.getState().requestPlay(active.controlRevision);
    else usePlaybackStore.getState().requestPause(active.controlRevision);
    if (!active.loadResolved) {
      active.pendingSeek = {
        positionMs: safePositionMs,
        resumeAfterSeek,
        controlRevision: active.controlRevision,
      };
      active.pendingPlayRevision = null;
      return;
    }
    await this.issueSeek(active, safePositionMs, resumeAfterSeek, operationToken);
  }

  private async issueSeek(
    active: ActivePreview,
    positionMs: number,
    resumeAfterSeek: boolean,
    operationToken: number,
  ): Promise<void> {
    try {
      await this.media.seekPreview({
        ...commandRequest(active),
        positionMs,
        resumeAfterSeek,
      });
    } catch (error) {
      if (this.isCurrentIntent(active, operationToken)) this.failActive(active, error);
    }
  }

  async release(): Promise<void> {
    const active = this.active;
    if (!active) {
      usePlaybackStore.getState().resetSession();
      return;
    }
    const operationToken = ++this.operationToken;
    active.controlRevision += 1;
    active.pendingPlayRevision = null;
    active.pendingSeek = null;
    usePlaybackStore.getState().requestPause(active.controlRevision);
    if (!active.nativeRegistered) {
      this.active = null;
      usePlaybackStore.getState().cancelSession(active.controlRevision);
      return;
    }
    try {
      await this.media.releasePreview(commandRequest(active));
    } catch (error) {
      this.failActive(active, error);
      throw new PreviewCoordinatorError(
        'PREVIEW_COMMAND_FAILED',
        'The native preview player could not be released.',
        { cause: error },
      );
    }
    if (operationToken === this.operationToken && this.isActive(active)) {
      this.active = null;
      usePlaybackStore.getState().resetSession();
    }
  }

  async releaseProject(projectId: string): Promise<void> {
    if (this.active?.projectId === projectId) await this.release();
  }

  private async load(
    mode: PreviewMode,
    project: SnapCutProject,
    clips: SnapCutClip[],
    key: string,
    intent: {
      operationToken: number;
      desiredPlaying: boolean;
      initialControlRevision: number;
    },
  ): Promise<boolean> {
    if (!this.started) this.start();
    if (!usePlaybackStore.getState().available) {
      usePlaybackStore.getState().fail();
      throw new PreviewCoordinatorError('PREVIEW_UNAVAILABLE', 'Native preview is unavailable.');
    }

    const orderedClips = clips;
    let nativeClips: NativePreviewClip[];
    try {
      nativeClips = buildNativeSequentialClips(project, orderedClips, this.sourceResolver);
    } catch (error) {
      usePlaybackStore.getState().fail();
      throw error;
    }

    const previous = this.active;
    const durationMs = compositionDurationMs(orderedClips);
    const active: ActivePreview = {
      projectId: project.id,
      playbackSessionId: this.idFactory(),
      generation: ++this.generation,
      mode,
      key,
      clipIds: orderedClips.map(({ id }) => id),
      controlRevision: intent.initialControlRevision,
      durationMs,
      nativeRegistered: false,
      loadResolved: false,
      pendingPlayRevision: null,
      pendingSeek: null,
      lastSequence: 0,
    };
    this.active = active;
    usePlaybackStore.getState().beginSession({
      projectId: active.projectId,
      playbackSessionId: active.playbackSessionId,
      generation: active.generation,
      controlRevision: active.controlRevision,
      mode: active.mode,
      desiredPlaying: intent.desiredPlaying,
    });

    if (previous) {
      previous.controlRevision += 1;
      previous.pendingPlayRevision = null;
      previous.pendingSeek = null;
      if (previous.nativeRegistered) {
        try {
          await this.media.pausePreview(commandRequest(previous));
        } catch {
          // A stale/finished previous session may already have released itself.
        }
      }
      if (!this.isCurrentIntent(active, intent.operationToken)) {
        await this.releaseTransitionSource(previous);
        return false;
      }
    }

    try {
      active.nativeRegistered = true;
      const request = { ...commandRequest(active), clips: nativeClips };
      if (mode === 'selection') await this.media.loadSelectionPreview(request);
      else await this.media.loadCompositionPreview(request);
      if (!this.isActive(active)) return false;
      active.loadResolved = true;
      await this.flushPendingCommands(active);
      return intent.operationToken === this.operationToken && this.isActive(active);
    } catch (error) {
      await this.invalidateRejectedSession(active, error);
      return false;
    }
  }

  private async flushPendingCommands(active: ActivePreview): Promise<void> {
    const pendingSeek = active.pendingSeek;
    active.pendingSeek = null;
    if (
      pendingSeek &&
      pendingSeek.controlRevision === active.controlRevision &&
      this.isActive(active)
    ) {
      await this.media.seekPreview({
        ...commandRequest(active),
        positionMs: pendingSeek.positionMs,
        resumeAfterSeek: pendingSeek.resumeAfterSeek,
      });
    }

    const pendingPlayRevision = active.pendingPlayRevision;
    active.pendingPlayRevision = null;
    if (
      pendingPlayRevision === active.controlRevision &&
      this.isActive(active) &&
      usePlaybackStore.getState().desiredPlaying
    ) {
      await this.media.playPreview(commandRequest(active));
    }
  }

  private async releaseTransitionSource(previous: ActivePreview): Promise<void> {
    if (!previous.nativeRegistered) return;
    await this.media.releasePreview(commandRequest(previous)).catch(() => undefined);
  }

  private async invalidateRejectedSession(active: ActivePreview, cause: unknown): Promise<void> {
    if (!this.isActive(active)) return;
    const state = usePlaybackStore.getState();
    const latestIntentStillWantsPlay =
      state.playbackSessionId === active.playbackSessionId &&
      state.generation === active.generation &&
      state.controlRevision === active.controlRevision &&
      state.desiredPlaying;

    this.active = null;
    if (latestIntentStillWantsPlay) {
      this.onDiagnostic({
        operation: 'preview',
        projectId: active.projectId,
        jobId: active.playbackSessionId,
        generation: active.generation,
        stage: active.mode,
        code: errorCode(cause, 'PREVIEW_COMMAND_FAILED'),
      });
      usePlaybackStore.getState().fail();
    } else {
      usePlaybackStore.getState().cancelSession(active.controlRevision);
    }
    if (active.nativeRegistered) {
      await this.media.releasePreview(commandRequest(active)).catch(() => undefined);
    }
  }

  private async failAndReleaseAfterPause(active: ActivePreview, cause: unknown): Promise<void> {
    this.onDiagnostic({
      operation: 'preview',
      projectId: active.projectId,
      jobId: active.playbackSessionId,
      generation: active.generation,
      stage: 'pause',
      code: errorCode(cause, 'PREVIEW_COMMAND_FAILED'),
    });
    usePlaybackStore.getState().fail();
    await this.media.releasePreview(commandRequest(active)).catch(() => undefined);
    if (this.isActive(active)) this.active = null;
  }

  private handleStatus(event: PlaybackStatusEvent): void {
    const active = this.active;
    if (
      !active ||
      event.operation !== 'preview' ||
      event.jobId !== active.playbackSessionId ||
      event.playbackSessionId !== active.playbackSessionId ||
      event.generation !== active.generation ||
      event.controlRevision < active.controlRevision ||
      event.mode !== active.mode ||
      event.sequence <= active.lastSequence ||
      !this.validClipPosition(active, event)
    ) {
      return;
    }
    if (event.controlRevision > active.controlRevision) {
      active.controlRevision = event.controlRevision;
      active.pendingPlayRevision = null;
      active.pendingSeek = null;
    }
    active.lastSequence = event.sequence;
    usePlaybackStore.getState().applyStatus(event, this.appIsActive);
  }

  private handleNativeError(event: NativeErrorEvent): void {
    const active = this.active;
    if (
      !active ||
      event.operation !== 'preview' ||
      event.jobId !== active.playbackSessionId ||
      event.generation !== active.generation
    ) {
      return;
    }
    this.onDiagnostic({
      operation: 'preview',
      projectId: active.projectId,
      jobId: active.playbackSessionId,
      generation: active.generation,
      stage: event.stage,
      code: event.code,
    });
    // PreviewController releases its players and native session before it
    // emits this terminal event. Drop the matching JS session immediately so
    // a retry always creates a fresh playbackSessionId instead of issuing
    // commands to a native session that no longer exists. A late rejection
    // from the original load then fails the isActive guard and cannot clear
    // this visible error.
    this.active = null;
    usePlaybackStore.getState().fail();
  }

  private validClipPosition(active: ActivePreview, event: PlaybackStatusEvent): boolean {
    if (event.currentClipIndex === null || event.currentClipId === null) {
      return event.currentClipIndex === null && event.currentClipId === null;
    }
    return active.clipIds[event.currentClipIndex] === event.currentClipId;
  }

  private requireActive(): ActivePreview {
    if (!this.active) {
      throw new PreviewCoordinatorError('PREVIEW_UNAVAILABLE', 'No preview is loaded.');
    }
    return this.active;
  }

  private isActive(active: ActivePreview): boolean {
    return (
      this.active?.playbackSessionId === active.playbackSessionId &&
      this.active.generation === active.generation
    );
  }

  private isCurrentIntent(active: ActivePreview, operationToken: number): boolean {
    return this.isActive(active) && operationToken === this.operationToken;
  }

  private isCurrentPlayIntent(active: ActivePreview, operationToken: number): boolean {
    const state = usePlaybackStore.getState();
    return (
      this.isCurrentIntent(active, operationToken) &&
      state.desiredPlaying &&
      state.controlRevision === active.controlRevision
    );
  }

  private failActive(active: ActivePreview, cause: unknown): void {
    this.onDiagnostic({
      operation: 'preview',
      projectId: active.projectId,
      jobId: active.playbackSessionId,
      generation: active.generation,
      stage: active.mode,
      code: errorCode(cause, 'PREVIEW_COMMAND_FAILED'),
    });
    if (this.isActive(active)) usePlaybackStore.getState().fail();
    if (cause instanceof PreviewCoordinatorError) throw cause;
  }
}

function errorCode(error: unknown, fallback: string): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : fallback;
}

export const previewCoordinator = new PreviewCoordinator();
