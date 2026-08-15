import { create } from 'zustand';

import { snapCutProjectSchema } from '@/domain/schemas';
import type { SnapCutClip, SnapCutProject } from '@/domain/types';

export const MAX_CLIP_EDIT_HISTORY = 50;

type ClipSnapshot = SnapCutClip[];

export interface ClipEditHistoryState {
  projectId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Call after a new clips edit saves, passing its captured pre-edit project. */
  record: (projectBeforeEdit: SnapCutProject) => void;
  /** Builds an undo candidate without changing history. */
  previewUndo: (latestProject: SnapCutProject) => SnapCutProject;
  /** Advances undo history after its preview was saved successfully. */
  commitUndo: (latestProjectBeforeUndo: SnapCutProject) => void;
  /** Builds a redo candidate without changing history. */
  previewRedo: (latestProject: SnapCutProject) => SnapCutProject;
  /** Advances redo history after its preview was saved successfully. */
  commitRedo: (latestProjectBeforeRedo: SnapCutProject) => void;
  /** Clears history when the active project changes. */
  syncProject: (projectId: string | null) => void;
  /** Clears snapshots that may reference a source removed from this project. */
  clearProjectHistory: (projectId: string) => void;
  reset: () => void;
}

let undoStack: ClipSnapshot[] = [];
let redoStack: ClipSnapshot[] = [];

function snapshotClips(project: SnapCutProject): ClipSnapshot {
  return project.clips.map((clip) => ({ ...clip }));
}

function cap(stack: ClipSnapshot[]): void {
  if (stack.length > MAX_CLIP_EDIT_HISTORY) {
    stack.splice(0, stack.length - MAX_CLIP_EDIT_HISTORY);
  }
}

function restoreClips(project: SnapCutProject, clips: ClipSnapshot): SnapCutProject {
  return snapCutProjectSchema.parse({
    ...project,
    clips: clips.map((clip) => ({ ...clip })),
  }) as SnapCutProject;
}

function clearStacks(): void {
  undoStack = [];
  redoStack = [];
}

export const useClipEditHistoryStore = create<ClipEditHistoryState>((set, get) => ({
  projectId: null,
  canUndo: false,
  canRedo: false,

  record: (projectInput) => {
    const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
    if (get().projectId !== project.id) clearStacks();
    undoStack.push(snapshotClips(project));
    cap(undoStack);
    redoStack = [];
    set({ projectId: project.id, canUndo: true, canRedo: false });
  },

  previewUndo: (projectInput) => {
    const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
    if (get().projectId !== project.id) {
      get().syncProject(project.id);
      return project;
    }
    const previousClips = undoStack.at(-1);
    if (!previousClips) return project;
    return restoreClips(project, previousClips);
  },

  commitUndo: (projectInput) => {
    const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
    if (get().projectId !== project.id) {
      get().syncProject(project.id);
      return;
    }
    if (!undoStack.pop()) return;
    redoStack.push(snapshotClips(project));
    cap(redoStack);
    set({ canUndo: undoStack.length > 0, canRedo: true });
  },

  previewRedo: (projectInput) => {
    const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
    if (get().projectId !== project.id) {
      get().syncProject(project.id);
      return project;
    }
    const nextClips = redoStack.at(-1);
    if (!nextClips) return project;
    return restoreClips(project, nextClips);
  },

  commitRedo: (projectInput) => {
    const project = snapCutProjectSchema.parse(projectInput) as SnapCutProject;
    if (get().projectId !== project.id) {
      get().syncProject(project.id);
      return;
    }
    if (!redoStack.pop()) return;
    undoStack.push(snapshotClips(project));
    cap(undoStack);
    set({ canUndo: true, canRedo: redoStack.length > 0 });
  },

  syncProject: (projectId) => {
    if (get().projectId === projectId) return;
    clearStacks();
    set({ projectId, canUndo: false, canRedo: false });
  },

  clearProjectHistory: (projectId) => {
    if (get().projectId !== projectId) return;
    clearStacks();
    set({ canUndo: false, canRedo: false });
  },

  reset: () => {
    clearStacks();
    set({ projectId: null, canUndo: false, canRedo: false });
  },
}));
