import { create } from 'zustand';

import { waveformFileSchema } from '@/domain';
import type { SnapCutProject, WaveformFileV1 } from '@/domain';

export interface WaveformReaderPort {
  loadWaveform(projectId: string, sourceId: string): Promise<WaveformFileV1 | null>;
}

export interface EditorServicePorts {
  waveformReader?: WaveformReaderPort | undefined;
}

export type WaveformLoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'failed';

export interface EditorState {
  projectId: string | null;
  editingClipId: string | null;
  waveformsBySourceId: Record<string, WaveformFileV1 | null>;
  waveformLoadStatesBySourceId: Record<string, WaveformLoadState>;
  timelineCursorMs: number;
  configureServices: (ports: EditorServicePorts) => void;
  syncProject: (project: SnapCutProject) => void;
  beginEditing: (clipId: string) => void;
  cancelEditing: () => void;
  setTimelineCursorMs: (value: number, projectDurationMs: number) => void;
  loadProjectWaveforms: (project: SnapCutProject) => Promise<void>;
  reset: () => void;
}

let editorPorts: EditorServicePorts = {};
let projectWaveformGeneration = 0;

const clampInteger = (value: number, minimum: number, maximum: number): number =>
  Math.min(
    Math.max(Number.isFinite(value) ? Math.round(value) : minimum, minimum),
    Math.max(minimum, maximum),
  );

function compositionDurationMs(project: SnapCutProject): number {
  return project.clips.reduce((total, clip) => total + Math.max(0, clip.endMs - clip.startMs), 0);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  editingClipId: null,
  waveformsBySourceId: {},
  waveformLoadStatesBySourceId: {},
  timelineCursorMs: 0,

  configureServices: (ports) => {
    editorPorts = ports;
  },

  syncProject: (project) => {
    const state = get();
    const changedProject = state.projectId !== project.id;
    const sourceIds = new Set(project.sources.map(({ id }) => id));
    set({
      projectId: project.id,
      editingClipId:
        !changedProject &&
        state.editingClipId &&
        project.clips.some(({ id }) => id === state.editingClipId)
          ? state.editingClipId
          : null,
      timelineCursorMs: changedProject
        ? 0
        : clampInteger(state.timelineCursorMs, 0, compositionDurationMs(project)),
      waveformsBySourceId: changedProject
        ? {}
        : Object.fromEntries(
            Object.entries(state.waveformsBySourceId).filter(([sourceId]) =>
              sourceIds.has(sourceId),
            ),
          ),
      waveformLoadStatesBySourceId: changedProject
        ? {}
        : Object.fromEntries(
            Object.entries(state.waveformLoadStatesBySourceId).filter(([sourceId]) =>
              sourceIds.has(sourceId),
            ),
          ),
    });
    void get().loadProjectWaveforms(project);
  },

  beginEditing: (clipId) => set({ editingClipId: clipId }),
  cancelEditing: () => set({ editingClipId: null }),

  setTimelineCursorMs: (value, projectDurationMs) => {
    set({ timelineCursorMs: clampInteger(value, 0, Math.max(0, projectDurationMs)) });
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
            waveformsBySourceId: { ...state.waveformsBySourceId, [source.id]: null },
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
          }));
        } catch {
          if (generation !== projectWaveformGeneration || get().projectId !== project.id) return;
          set((state) => ({
            waveformsBySourceId: { ...state.waveformsBySourceId, [source.id]: null },
            waveformLoadStatesBySourceId: {
              ...state.waveformLoadStatesBySourceId,
              [source.id]: 'failed',
            },
          }));
        }
      }),
    );
  },

  reset: () => {
    projectWaveformGeneration += 1;
    set({
      projectId: null,
      editingClipId: null,
      waveformsBySourceId: {},
      waveformLoadStatesBySourceId: {},
      timelineCursorMs: 0,
    });
  },
}));

export function configureEditorServices(ports: EditorServicePorts): void {
  useEditorStore.getState().configureServices(ports);
}
