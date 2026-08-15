import { create } from 'zustand';

import { defaultSelectionForSource, waveformFileSchema } from '@/domain';
import type { SnapCutClip, SnapCutProject, SnapCutSource, TrackId, WaveformFileV1 } from '@/domain';

const MINIMUM_CLIP_DURATION_MS = 100;
const MINIMUM_ZOOM = 1;
const MAXIMUM_ZOOM = 32;
const DEFAULT_TIMELINE_VISIBLE_SPAN_MS = 30_000;
const MINIMUM_TIMELINE_VISIBLE_SPAN_MS = 1_000;

export interface WaveformReaderPort {
  loadWaveform(projectId: string, sourceId: string): Promise<WaveformFileV1 | null>;
}

export interface EditorServicePorts {
  waveformReader?: WaveformReaderPort | undefined;
}

export type WaveformLoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'failed';

export interface EditorState {
  projectId: string | null;
  selectedSourceId: string | null;
  selectedTrackId: TrackId;
  editingClipId: string | null;
  selectionStartMs: number;
  selectionEndMs: number;
  zoom: number;
  viewportStartMs: number;
  waveform: WaveformFileV1 | null;
  waveformLoadState: WaveformLoadState;
  waveformsBySourceId: Record<string, WaveformFileV1 | null>;
  waveformLoadStatesBySourceId: Record<string, WaveformLoadState>;
  timelineCursorMs: number;
  timelineVisibleSpanMs: number;
  configureServices: (ports: EditorServicePorts) => void;
  syncProject: (project: SnapCutProject) => void;
  selectSource: (projectId: string, source: SnapCutSource) => void;
  selectTrack: (trackId: TrackId) => void;
  setSelectionStartMs: (value: number, sourceDurationMs: number) => void;
  setSelectionEndMs: (value: number, sourceDurationMs: number) => void;
  beginEditing: (clip: SnapCutClip, source: SnapCutSource) => void;
  cancelEditing: () => void;
  setZoom: (value: number, sourceDurationMs: number) => void;
  panViewport: (deltaMs: number, sourceDurationMs: number) => void;
  setTimelineCursorMs: (value: number, projectDurationMs: number) => void;
  setTimelineNavigation: (
    cursorMs: number,
    visibleSpanMs: number,
    projectDurationMs: number,
  ) => void;
  loadProjectWaveforms: (project: SnapCutProject) => Promise<void>;
  loadSelectedWaveform: (projectId: string, source: SnapCutSource) => Promise<void>;
  reset: () => void;
}

let editorPorts: EditorServicePorts = {};
let waveformGeneration = 0;
let projectWaveformGeneration = 0;

const integer = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0);
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

function maximumViewportStart(durationMs: number, zoom: number): number {
  const duration = Math.max(0, integer(durationMs));
  return Math.max(0, duration - duration / zoom);
}

function normalizeTimelineVisibleSpan(value: number, durationMs: number): number {
  const duration = Math.max(0, integer(durationMs));
  if (duration === 0) return DEFAULT_TIMELINE_VISIBLE_SPAN_MS;
  const minimum = Math.min(MINIMUM_TIMELINE_VISIBLE_SPAN_MS, duration);
  return clamp(integer(value), minimum, duration);
}

function defaultTimelineVisibleSpan(durationMs: number): number {
  const duration = Math.max(0, integer(durationMs));
  if (duration === 0) return DEFAULT_TIMELINE_VISIBLE_SPAN_MS;
  return normalizeTimelineVisibleSpan(DEFAULT_TIMELINE_VISIBLE_SPAN_MS, duration);
}

function projectDurationMs(project: SnapCutProject): number {
  return project.clips.reduce(
    (maximum, clip) =>
      Math.max(maximum, clip.timelineStartMs + Math.max(0, clip.endMs - clip.startMs)),
    0,
  );
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  selectedSourceId: null,
  selectedTrackId: 'track-1',
  editingClipId: null,
  selectionStartMs: 0,
  selectionEndMs: 0,
  zoom: MINIMUM_ZOOM,
  viewportStartMs: 0,
  waveform: null,
  waveformLoadState: 'idle',
  waveformsBySourceId: {},
  waveformLoadStatesBySourceId: {},
  timelineCursorMs: 0,
  timelineVisibleSpanMs: DEFAULT_TIMELINE_VISIBLE_SPAN_MS,

  configureServices: (ports) => {
    editorPorts = ports;
  },

  syncProject: (project) => {
    const state = get();
    const selectedTrackId = state.selectedTrackId;
    const timelineDurationMs = projectDurationMs(project);
    const currentSource = project.sources.find(({ id }) => id === state.selectedSourceId);
    if (state.projectId === project.id && currentSource) {
      const duration = currentSource.durationMs;
      set({
        selectedTrackId,
        editingClipId:
          state.editingClipId && project.clips.some(({ id }) => id === state.editingClipId)
            ? state.editingClipId
            : null,
        selectionStartMs: clamp(state.selectionStartMs, 0, Math.max(0, duration - 1)),
        selectionEndMs: clamp(state.selectionEndMs, 0, duration),
        viewportStartMs: clamp(
          state.viewportStartMs,
          0,
          maximumViewportStart(duration, state.zoom),
        ),
        timelineCursorMs: clamp(state.timelineCursorMs, 0, timelineDurationMs),
        timelineVisibleSpanMs: normalizeTimelineVisibleSpan(
          state.timelineVisibleSpanMs,
          timelineDurationMs,
        ),
        ...(currentSource.waveformStatus !== 'ready'
          ? { waveform: null, waveformLoadState: 'unavailable' as const }
          : {}),
      });
      void get().loadProjectWaveforms(project);
      if (
        currentSource.waveformStatus === 'ready' &&
        state.waveformLoadState !== 'ready' &&
        state.waveformLoadState !== 'loading'
      ) {
        void get().loadSelectedWaveform(project.id, currentSource);
      }
      return;
    }

    const firstSource = project.sources[0];
    if (!firstSource) {
      waveformGeneration += 1;
      set({
        projectId: project.id,
        selectedSourceId: null,
        selectedTrackId,
        editingClipId: null,
        selectionStartMs: 0,
        selectionEndMs: 0,
        zoom: MINIMUM_ZOOM,
        viewportStartMs: 0,
        waveform: null,
        waveformLoadState: 'idle',
        waveformsBySourceId: {},
        waveformLoadStatesBySourceId: {},
        timelineCursorMs: 0,
        timelineVisibleSpanMs: DEFAULT_TIMELINE_VISIBLE_SPAN_MS,
      });
      return;
    }
    const changedProject = state.projectId !== project.id;
    get().selectSource(project.id, firstSource);
    set({
      selectedTrackId,
      ...(changedProject
        ? {
            timelineCursorMs: 0,
            timelineVisibleSpanMs: defaultTimelineVisibleSpan(timelineDurationMs),
          }
        : {
            timelineVisibleSpanMs: normalizeTimelineVisibleSpan(
              state.timelineVisibleSpanMs,
              timelineDurationMs,
            ),
            timelineCursorMs: clamp(state.timelineCursorMs, 0, timelineDurationMs),
          }),
    });
    void get().loadProjectWaveforms(project);
  },

  selectSource: (projectId, source) => {
    waveformGeneration += 1;
    const selection = defaultSelectionForSource(source);
    set({
      projectId,
      selectedSourceId: source.id,
      editingClipId: null,
      selectionStartMs: selection.startMs,
      selectionEndMs: selection.endMs,
      zoom: MINIMUM_ZOOM,
      viewportStartMs: 0,
      waveform: null,
      waveformLoadState: 'idle',
    });
    void get().loadSelectedWaveform(projectId, source);
  },

  selectTrack: (trackId) => set({ selectedTrackId: trackId }),

  setSelectionStartMs: (value, sourceDurationMs) => {
    const duration = Math.max(0, integer(sourceDurationMs));
    const state = get();
    const maximum =
      duration >= MINIMUM_CLIP_DURATION_MS
        ? Math.min(
            duration - MINIMUM_CLIP_DURATION_MS,
            state.selectionEndMs - MINIMUM_CLIP_DURATION_MS,
          )
        : 0;
    set({ selectionStartMs: clamp(integer(value), 0, maximum) });
  },

  setSelectionEndMs: (value, sourceDurationMs) => {
    const duration = Math.max(0, integer(sourceDurationMs));
    const state = get();
    const minimum =
      duration >= MINIMUM_CLIP_DURATION_MS
        ? Math.min(duration, state.selectionStartMs + MINIMUM_CLIP_DURATION_MS)
        : duration;
    set({ selectionEndMs: clamp(integer(value), minimum, duration) });
  },

  beginEditing: (clip, source) => {
    waveformGeneration += 1;
    set({
      selectedSourceId: source.id,
      editingClipId: clip.id,
      selectionStartMs: clip.startMs,
      selectionEndMs: clip.endMs,
      zoom: MINIMUM_ZOOM,
      viewportStartMs: 0,
      waveform: null,
      waveformLoadState: 'idle',
    });
    const projectId = get().projectId;
    if (projectId) void get().loadSelectedWaveform(projectId, source);
  },

  cancelEditing: () => set({ editingClipId: null }),

  setZoom: (value, sourceDurationMs) => {
    const zoom = clamp(integer(value), MINIMUM_ZOOM, MAXIMUM_ZOOM);
    set((state) => ({
      zoom,
      viewportStartMs: clamp(
        state.viewportStartMs,
        0,
        maximumViewportStart(sourceDurationMs, zoom),
      ),
    }));
  },

  panViewport: (deltaMs, sourceDurationMs) => {
    set((state) => ({
      viewportStartMs: clamp(
        integer(state.viewportStartMs + deltaMs),
        0,
        maximumViewportStart(sourceDurationMs, state.zoom),
      ),
    }));
  },

  setTimelineCursorMs: (value, projectDurationMs) => {
    set({
      timelineCursorMs: clamp(integer(value), 0, Math.max(0, integer(projectDurationMs))),
    });
  },

  setTimelineNavigation: (cursorMs, visibleSpanMs, projectDurationMs) => {
    const duration = Math.max(0, integer(projectDurationMs));
    set({
      timelineCursorMs: clamp(integer(cursorMs), 0, duration),
      timelineVisibleSpanMs: normalizeTimelineVisibleSpan(visibleSpanMs, duration),
    });
  },

  loadProjectWaveforms: async (project) => {
    const generation = ++projectWaveformGeneration;
    const sourceIds = new Set(project.sources.map(({ id }) => id));
    set((state) => ({
      waveformsBySourceId: Object.fromEntries(
        Object.entries(state.waveformsBySourceId).filter(([sourceId]) => sourceIds.has(sourceId)),
      ),
      waveformLoadStatesBySourceId: Object.fromEntries(
        Object.entries(state.waveformLoadStatesBySourceId).filter(([sourceId]) =>
          sourceIds.has(sourceId),
        ),
      ),
    }));
    if (!editorPorts.waveformReader) return;
    await Promise.all(
      project.sources.map(async (source) => {
        if (source.waveformStatus !== 'ready') {
          set((state) => ({
            waveformLoadStatesBySourceId: {
              ...state.waveformLoadStatesBySourceId,
              [source.id]: 'unavailable',
            },
          }));
          return;
        }
        const current = get();
        if (
          current.waveformLoadStatesBySourceId[source.id] === 'ready' &&
          current.waveformsBySourceId[source.id]
        ) {
          return;
        }
        set((state) => ({
          waveformLoadStatesBySourceId: {
            ...state.waveformLoadStatesBySourceId,
            [source.id]: 'loading',
          },
        }));
        try {
          const result = await editorPorts.waveformReader!.loadWaveform(project.id, source.id);
          if (generation !== projectWaveformGeneration || get().projectId !== project.id) return;
          const waveform = result ? (waveformFileSchema.parse(result) as WaveformFileV1) : null;
          set((state) => ({
            waveformsBySourceId: { ...state.waveformsBySourceId, [source.id]: waveform },
            waveformLoadStatesBySourceId: {
              ...state.waveformLoadStatesBySourceId,
              [source.id]: waveform ? 'ready' : 'unavailable',
            },
            ...(state.selectedSourceId === source.id
              ? {
                  waveform,
                  waveformLoadState: waveform ? ('ready' as const) : ('unavailable' as const),
                }
              : {}),
          }));
        } catch {
          if (generation !== projectWaveformGeneration || get().projectId !== project.id) return;
          set((state) => ({
            waveformLoadStatesBySourceId: {
              ...state.waveformLoadStatesBySourceId,
              [source.id]: 'failed',
            },
          }));
        }
      }),
    );
  },

  loadSelectedWaveform: async (projectId, source) => {
    const generation = ++waveformGeneration;
    if (source.waveformStatus !== 'ready' || !editorPorts.waveformReader) {
      set({ waveform: null, waveformLoadState: 'unavailable' });
      return;
    }
    set({ waveform: null, waveformLoadState: 'loading' });
    try {
      const result = await editorPorts.waveformReader.loadWaveform(projectId, source.id);
      if (generation !== waveformGeneration || get().selectedSourceId !== source.id) return;
      if (!result) {
        set({ waveform: null, waveformLoadState: 'unavailable' });
        return;
      }
      const waveform = waveformFileSchema.parse(result) as WaveformFileV1;
      set((state) => ({
        waveform,
        waveformLoadState: 'ready',
        waveformsBySourceId: { ...state.waveformsBySourceId, [source.id]: waveform },
        waveformLoadStatesBySourceId: {
          ...state.waveformLoadStatesBySourceId,
          [source.id]: 'ready',
        },
      }));
    } catch {
      if (generation === waveformGeneration && get().selectedSourceId === source.id) {
        set({ waveform: null, waveformLoadState: 'failed' });
      }
    }
  },

  reset: () => {
    waveformGeneration += 1;
    projectWaveformGeneration += 1;
    set({
      projectId: null,
      selectedSourceId: null,
      selectedTrackId: 'track-1',
      editingClipId: null,
      selectionStartMs: 0,
      selectionEndMs: 0,
      zoom: MINIMUM_ZOOM,
      viewportStartMs: 0,
      waveform: null,
      waveformLoadState: 'idle',
      waveformsBySourceId: {},
      waveformLoadStatesBySourceId: {},
      timelineCursorMs: 0,
      timelineVisibleSpanMs: DEFAULT_TIMELINE_VISIBLE_SPAN_MS,
    });
  },
}));

export function configureEditorServices(ports: EditorServicePorts): void {
  useEditorStore.getState().configureServices(ports);
}
