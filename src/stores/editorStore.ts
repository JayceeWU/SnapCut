import { create } from 'zustand';

import { defaultSelectionForSource, waveformFileSchema } from '@/domain';
import type { SnapCutClip, SnapCutProject, SnapCutSource, WaveformFileV1 } from '@/domain';

const MINIMUM_CLIP_DURATION_MS = 100;
const MINIMUM_ZOOM = 1;
const MAXIMUM_ZOOM = 32;

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
  editingClipId: string | null;
  selectionStartMs: number;
  selectionEndMs: number;
  zoom: number;
  viewportStartMs: number;
  waveform: WaveformFileV1 | null;
  waveformLoadState: WaveformLoadState;
  configureServices: (ports: EditorServicePorts) => void;
  syncProject: (project: SnapCutProject) => void;
  selectSource: (projectId: string, source: SnapCutSource) => void;
  setSelectionStartMs: (value: number, sourceDurationMs: number) => void;
  setSelectionEndMs: (value: number, sourceDurationMs: number) => void;
  beginEditing: (clip: SnapCutClip, source: SnapCutSource) => void;
  cancelEditing: () => void;
  setZoom: (value: number, sourceDurationMs: number) => void;
  panViewport: (deltaMs: number, sourceDurationMs: number) => void;
  loadSelectedWaveform: (projectId: string, source: SnapCutSource) => Promise<void>;
  reset: () => void;
}

let editorPorts: EditorServicePorts = {};
let waveformGeneration = 0;

const integer = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0);
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

function maximumViewportStart(durationMs: number, zoom: number): number {
  const duration = Math.max(0, integer(durationMs));
  return Math.max(0, duration - duration / zoom);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  selectedSourceId: null,
  editingClipId: null,
  selectionStartMs: 0,
  selectionEndMs: 0,
  zoom: MINIMUM_ZOOM,
  viewportStartMs: 0,
  waveform: null,
  waveformLoadState: 'idle',

  configureServices: (ports) => {
    editorPorts = ports;
  },

  syncProject: (project) => {
    const state = get();
    const currentSource = project.sources.find(({ id }) => id === state.selectedSourceId);
    if (state.projectId === project.id && currentSource) {
      const duration = currentSource.durationMs;
      set({
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
        ...(currentSource.waveformStatus !== 'ready'
          ? { waveform: null, waveformLoadState: 'unavailable' as const }
          : {}),
      });
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
        editingClipId: null,
        selectionStartMs: 0,
        selectionEndMs: 0,
        zoom: MINIMUM_ZOOM,
        viewportStartMs: 0,
        waveform: null,
        waveformLoadState: 'idle',
      });
      return;
    }
    get().selectSource(project.id, firstSource);
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
      set({ waveform, waveformLoadState: 'ready' });
    } catch {
      if (generation === waveformGeneration && get().selectedSourceId === source.id) {
        set({ waveform: null, waveformLoadState: 'failed' });
      }
    }
  },

  reset: () => {
    waveformGeneration += 1;
    set({
      projectId: null,
      selectedSourceId: null,
      editingClipId: null,
      selectionStartMs: 0,
      selectionEndMs: 0,
      zoom: MINIMUM_ZOOM,
      viewportStartMs: 0,
      waveform: null,
      waveformLoadState: 'idle',
    });
  },
}));

export function configureEditorServices(ports: EditorServicePorts): void {
  useEditorStore.getState().configureServices(ports);
}
