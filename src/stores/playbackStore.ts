import { create } from 'zustand';

import { copy } from '@/constants';
import type { PlaybackStatusEvent } from '@/native';

export type PreviewMode = 'selection' | 'composition';

export interface BeginPlaybackSession {
  projectId: string;
  playbackSessionId: string;
  generation: number;
  controlRevision: number;
  mode: PreviewMode;
  desiredPlaying?: boolean;
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
  desiredPlaying: boolean;
  pausePending: boolean;
  controlRevision: number;
  positionMs: number;
  durationMs: number;
  currentClipIndex: number | null;
  currentClipId: string | null;
  didJustFinish: boolean;
  error: string | null;
  setAvailable: (available: boolean) => void;
  beginSession: (session: BeginPlaybackSession) => void;
  requestPlay: (controlRevision: number) => void;
  requestPause: (controlRevision: number) => void;
  cancelSession: (controlRevision: number) => void;
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
  desiredPlaying: false,
  pausePending: false,
  controlRevision: 0,
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
      desiredPlaying: session.desiredPlaying ?? false,
      pausePending: false,
      controlRevision: session.controlRevision,
      positionMs: 0,
      durationMs: 0,
      currentClipIndex: null,
      currentClipId: null,
      didJustFinish: false,
      error: null,
    }),

  requestPlay: (controlRevision) =>
    set((state) =>
      controlRevision < state.controlRevision
        ? state
        : {
            controlRevision,
            desiredPlaying: true,
            pausePending: false,
            didJustFinish: false,
            error: null,
          },
    ),

  requestPause: (controlRevision) =>
    set((state) =>
      controlRevision < state.controlRevision
        ? state
        : {
            controlRevision,
            desiredPlaying: false,
            pausePending: true,
            playing: false,
            didJustFinish: false,
          },
    ),

  cancelSession: (controlRevision) =>
    set((state) =>
      controlRevision !== state.controlRevision
        ? state
        : {
            loading: false,
            loaded: false,
            playing: false,
            desiredPlaying: false,
            pausePending: false,
            error: null,
          },
    ),

  applyStatus: (event, appIsActive) =>
    set((state) => {
      if (event.controlRevision < state.controlRevision) return state;
      const nativeControlAdvanced = event.controlRevision > state.controlRevision;
      const didStop = !event.playing;
      const desiredPlaying = event.didJustFinish
        ? false
        : nativeControlAdvanced
          ? event.playing
          : state.desiredPlaying;
      const freezeOptimisticPause = !nativeControlAdvanced && state.pausePending && event.playing;
      return {
        loading: false,
        loaded: event.loaded,
        playing: appIsActive && desiredPlaying && !state.pausePending && event.playing,
        desiredPlaying,
        pausePending: didStop ? false : state.pausePending,
        controlRevision: event.controlRevision,
        positionMs: freezeOptimisticPause ? state.positionMs : event.positionMs,
        durationMs: event.durationMs,
        currentClipIndex: event.currentClipIndex,
        currentClipId: event.currentClipId,
        didJustFinish: event.didJustFinish,
        error: null,
      };
    }),

  fail: (message = copy.editor.previewError) =>
    set({
      loading: false,
      loaded: false,
      playing: false,
      desiredPlaying: false,
      pausePending: false,
      error: message,
    }),

  markBackgroundPaused: () => set({ playing: false, desiredPlaying: false, pausePending: false }),
  clearError: () => set({ error: null }),
  resetSession: () => set(idleSession),
  reset: () => set({ available: false, ...idleSession }),
}));
