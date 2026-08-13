import { create } from 'zustand';

import { copy } from '@/constants';
import type { PlaybackStatusEvent } from '@/native';

export type PreviewMode = 'selection' | 'composition';

export interface BeginPlaybackSession {
  projectId: string;
  playbackSessionId: string;
  generation: number;
  mode: PreviewMode;
}

interface PlaybackState {
  available: boolean;
  projectId: string | null;
  playbackSessionId: string | null;
  generation: number;
  mode: PreviewMode | null;
  loading: boolean;
  loaded: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  currentClipIndex: number | null;
  currentClipId: string | null;
  didJustFinish: boolean;
  error: string | null;
  setAvailable: (available: boolean) => void;
  beginSession: (session: BeginPlaybackSession) => void;
  applyStatus: (event: PlaybackStatusEvent, appIsActive: boolean) => void;
  fail: (message?: string) => void;
  markBackgroundPaused: () => void;
  clearError: () => void;
  resetSession: () => void;
  reset: () => void;
}

const idleSession = {
  projectId: null,
  playbackSessionId: null,
  generation: 0,
  mode: null,
  loading: false,
  loaded: false,
  playing: false,
  positionMs: 0,
  durationMs: 0,
  currentClipIndex: null,
  currentClipId: null,
  didJustFinish: false,
  error: null,
} as const;

export const usePlaybackStore = create<PlaybackState>((set) => ({
  available: false,
  ...idleSession,

  setAvailable: (available) => set({ available }),

  beginSession: (session) =>
    set({
      ...session,
      loading: true,
      loaded: false,
      playing: false,
      positionMs: 0,
      durationMs: 0,
      currentClipIndex: null,
      currentClipId: null,
      didJustFinish: false,
      error: null,
    }),

  applyStatus: (event, appIsActive) =>
    set({
      loading: false,
      loaded: event.loaded,
      playing: appIsActive && event.playing,
      positionMs: event.positionMs,
      durationMs: event.durationMs,
      currentClipIndex: event.currentClipIndex,
      currentClipId: event.currentClipId,
      didJustFinish: event.didJustFinish,
      error: null,
    }),

  fail: (message = copy.editor.previewError) =>
    set({ loading: false, loaded: false, playing: false, error: message }),

  markBackgroundPaused: () => set({ playing: false }),
  clearError: () => set({ error: null }),
  resetSession: () => set(idleSession),
  reset: () => set({ available: false, ...idleSession }),
}));
