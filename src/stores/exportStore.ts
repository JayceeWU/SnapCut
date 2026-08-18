import { create } from 'zustand';

import type { ExportPreflightResult, SnapCutExportFormat } from '@/domain';
import type { ExportAudioResult } from '@/native';

export type ExportStatus =
  'idle' | 'preflighting' | 'ready' | 'exporting' | 'cancelling' | 'success' | 'failed';

interface ExportSession {
  projectId: string;
  jobId: string;
  generation: number;
}

interface ExportStoreState {
  status: ExportStatus;
  projectId: string | null;
  jobId: string | null;
  generation: number;
  preflight: ExportPreflightResult | null;
  selectedFormat: SnapCutExportFormat | null;
  displayNameWithoutExtension: string;
  compositionDurationMs: number;
  stage: string | null;
  progress: number | null;
  result: ExportAudioResult | null;
  error: string | null;
  beginPreflight: (
    session: ExportSession,
    displayName: string,
    compositionDurationMs: number,
  ) => void;
  preflightReady: (preflight: ExportPreflightResult) => void;
  selectFormat: (format: SnapCutExportFormat) => void;
  setDisplayName: (value: string) => void;
  beginExport: (session: ExportSession) => void;
  applyProgress: (stage: string, fraction: number | null) => void;
  beginCancelling: () => void;
  complete: (result: ExportAudioResult) => void;
  fail: (message: string) => void;
  reset: () => void;
}

const initialState = {
  status: 'idle' as const,
  projectId: null,
  jobId: null,
  generation: 0,
  preflight: null,
  selectedFormat: null,
  displayNameWithoutExtension: '',
  compositionDurationMs: 0,
  stage: null,
  progress: null,
  result: null,
  error: null,
};

export const useExportStore = create<ExportStoreState>((set) => ({
  ...initialState,

  beginPreflight: (session, displayName, compositionDurationMs) =>
    set({
      ...session,
      status: 'preflighting',
      preflight: null,
      selectedFormat: null,
      displayNameWithoutExtension: displayName,
      compositionDurationMs,
      stage: 'Preflight',
      progress: null,
      result: null,
      error: null,
    }),

  preflightReady: (preflight) => {
    const preferred = preflight.formats.find(
      ({ available, format }) => available && format === preflight.preferredFormat,
    );
    const fallback = preflight.formats.find(({ available }) => available);
    set({
      status: 'ready',
      preflight,
      selectedFormat: preferred?.format ?? fallback?.format ?? null,
      stage: null,
      progress: null,
      error: null,
    });
  },

  selectFormat: (selectedFormat) => set({ selectedFormat }),
  setDisplayName: (displayNameWithoutExtension) => set({ displayNameWithoutExtension }),
  beginExport: (session) =>
    set({
      ...session,
      status: 'exporting',
      stage: 'Starting',
      progress: 0,
      result: null,
      error: null,
    }),
  applyProgress: (stage, progress) => set({ stage, progress }),
  beginCancelling: () => set({ status: 'cancelling' }),
  complete: (result) => set({ status: 'success', result, stage: null, progress: 1, error: null }),
  fail: (error) => set({ status: 'failed', error, stage: null, progress: null }),
  reset: () => set(initialState),
}));
