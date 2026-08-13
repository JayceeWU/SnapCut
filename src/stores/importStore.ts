import { create } from 'zustand';

import type { ImportFailure } from '@/services/ImportErrors';

export type ImportUiStage =
  | 'idle'
  | 'picking'
  | 'inspecting'
  | 'extracting_or_copying'
  | 'verifying'
  | 'committing'
  | 'scheduling_waveform'
  | 'complete'
  | 'canceling'
  | 'cancelled'
  | 'failed';

export interface ImportProgressSnapshot {
  readonly generation: number;
  readonly activeJobId: string | null;
  readonly projectId: string | null;
  readonly sourceId: string | null;
  readonly stage: ImportUiStage;
  readonly fraction: number | null;
  readonly failure: ImportFailure | null;
  readonly lastImportedSourceId: string | null;
}

interface ImportStoreState extends ImportProgressSnapshot {
  replace(snapshot: ImportProgressSnapshot): void;
  reset(): void;
}

const INITIAL_IMPORT_STATE: ImportProgressSnapshot = {
  generation: 0,
  activeJobId: null,
  projectId: null,
  sourceId: null,
  stage: 'idle',
  fraction: null,
  failure: null,
  lastImportedSourceId: null,
};

export const useImportStore = create<ImportStoreState>((set) => ({
  ...INITIAL_IMPORT_STATE,
  replace: (snapshot) => set(snapshot),
  reset: () => set(INITIAL_IMPORT_STATE),
}));

export interface ImportStateSink {
  publish(snapshot: ImportProgressSnapshot): void;
}

export const importStateSink: ImportStateSink = {
  publish: (snapshot) => useImportStore.getState().replace(snapshot),
};

export function resetImportStore(): void {
  useImportStore.getState().reset();
}
