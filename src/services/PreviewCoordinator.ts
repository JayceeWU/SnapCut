import { AppState, type AppStateStatus } from 'react-native';
import { randomUUID } from 'expo-crypto';

import { validateClipRange } from '@/domain';
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
  lastSequence: number;
}

const commandRequest = (active: ActivePreview) => ({
  playbackSessionId: active.playbackSessionId,
  generation: active.generation,
});

const selectionKey = (projectId: string, clip: SnapCutClip): string =>
  `selection:${projectId}:${clip.sourceId}:${clip.startMs}:${clip.endMs}`;

const compositionKey = (project: SnapCutProject): string =>
  `composition:${project.id}:${project.clips
    .map(({ id, sourceId, startMs, endMs }) => `${id}:${sourceId}:${startMs}:${endMs}`)
    .join('|')}`;

const clampInteger = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(Math.round(Number.isFinite(value) ? value : 0), minimum), maximum);

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
    const clip = validateClipRange(clipInput, project.sources);
    return this.load('selection', project, [clip], selectionKey(project.id, clip));
  }

  async loadComposition(project: SnapCutProject): Promise<boolean> {
    if (project.clips.length === 0) {
      throw new PreviewCoordinatorError('EMPTY_COMPOSITION', 'Composition preview needs a clip.');
    }
    const clips = project.clips.map((clip) => validateClipRange(clip, project.sources));
    return this.load('composition', project, clips, compositionKey(project));
  }

  async toggleSelection(project: SnapCutProject, clip: SnapCutClip): Promise<void> {
    const key = selectionKey(project.id, clip);
    if (this.active?.key === key) {
      const state = usePlaybackStore.getState();
      if (state.playing) await this.pause();
      else if (state.loaded) await this.play();
      else if (!state.loading && (await this.loadSelection(project, clip))) await this.play();
      return;
    }
    if (await this.loadSelection(project, clip)) await this.play();
  }

  async toggleComposition(project: SnapCutProject): Promise<void> {
    const key = compositionKey(project);
    if (this.active?.key === key) {
      const state = usePlaybackStore.getState();
      if (state.playing) await this.pause();
      else if (state.loaded) await this.play();
      else if (!state.loading && (await this.loadComposition(project))) await this.play();
      return;
    }
    if (await this.loadComposition(project)) await this.play();
  }

  async play(): Promise<void> {
    if (!this.appIsActive) {
      usePlaybackStore.getState().markBackgroundPaused();
      return;
    }
    const active = this.requireActive();
    try {
      await this.media.playPreview(commandRequest(active));
    } catch (error) {
      this.failActive(active, error);
    }
  }

  async pause(): Promise<void> {
    const active = this.active;
    if (!active) return;
    try {
      await this.media.pausePreview(commandRequest(active));
    } catch (error) {
      this.failActive(active, error);
    }
  }

  async seek(positionMs: number): Promise<void> {
    const active = this.requireActive();
    const durationMs = usePlaybackStore.getState().durationMs;
    const safePositionMs = clampInteger(positionMs, 0, Math.max(0, durationMs));
    try {
      await this.media.seekPreview({ ...commandRequest(active), positionMs: safePositionMs });
    } catch (error) {
      this.failActive(active, error);
    }
  }

  async release(): Promise<void> {
    const active = this.active;
    if (!active) {
      usePlaybackStore.getState().resetSession();
      return;
    }
    const operationToken = ++this.operationToken;
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
  ): Promise<boolean> {
    if (!this.started) this.start();
    if (!usePlaybackStore.getState().available) {
      usePlaybackStore.getState().fail();
      throw new PreviewCoordinatorError('PREVIEW_UNAVAILABLE', 'Native preview is unavailable.');
    }

    let nativeClips: NativePreviewClip[];
    try {
      nativeClips = clips.map((clip) => this.nativeClip(project, clip));
    } catch (error) {
      usePlaybackStore.getState().fail();
      throw error;
    }

    const operationToken = ++this.operationToken;
    const previous = this.active;
    if (previous) {
      try {
        await this.media.pausePreview(commandRequest(previous));
      } catch {
        // A stale/finished previous session may already have released itself.
      }
      if (operationToken !== this.operationToken) return false;
    }

    const active: ActivePreview = {
      projectId: project.id,
      playbackSessionId: this.idFactory(),
      generation: ++this.generation,
      mode,
      key,
      clipIds: clips.map(({ id }) => id),
      lastSequence: 0,
    };
    this.active = active;
    usePlaybackStore.getState().beginSession(active);

    try {
      const request = { ...commandRequest(active), clips: nativeClips };
      if (mode === 'selection') await this.media.loadSelectionPreview(request);
      else await this.media.loadCompositionPreview(request);
      return operationToken === this.operationToken && this.isActive(active);
    } catch (error) {
      if (operationToken === this.operationToken && this.isActive(active)) {
        this.failActive(active, error);
      }
      return false;
    }
  }

  private nativeClip(project: SnapCutProject, clip: SnapCutClip): NativePreviewClip {
    const source = project.sources.find(({ id }) => id === clip.sourceId);
    if (!source) {
      throw new PreviewCoordinatorError(
        'MISSING_COMMITTED_SOURCE',
        `Clip source is not committed in project ${project.id}.`,
      );
    }
    return {
      clipId: clip.id,
      sourceId: source.id,
      audioFileUri: this.sourceResolver.resolveSourceAudioUri(project, source),
      startMs: clip.startMs,
      endMs: clip.endMs,
    };
  }

  private handleStatus(event: PlaybackStatusEvent): void {
    const active = this.active;
    if (
      !active ||
      event.operation !== 'preview' ||
      event.jobId !== active.playbackSessionId ||
      event.playbackSessionId !== active.playbackSessionId ||
      event.generation !== active.generation ||
      event.mode !== active.mode ||
      event.sequence <= active.lastSequence ||
      !this.validClipPosition(active, event)
    ) {
      return;
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
