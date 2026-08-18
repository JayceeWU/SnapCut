import SnapCutMedia from '@/native/SnapCutMedia';
import { diagnosticLog } from '@/diagnostics';
import { projectRepository, type ProjectRepository } from '@/repositories/ProjectRepository';
import { ImportCoordinator, type ImportMediaPort } from './ImportCoordinator';
import { WaveformScheduler, type NativeWaveformPort } from './WaveformScheduler';

export interface ImportRuntime {
  readonly coordinator: ImportCoordinator;
  readonly waveformScheduler: WaveformScheduler;
}

interface ProjectMediaDeletionRuntime {
  readonly coordinator: Pick<ImportCoordinator, 'cancelActive'>;
  readonly waveformScheduler: Pick<WaveformScheduler, 'cancelAll'>;
}

/**
 * Call from application bootstrap after the native module is available. Tests
 * should construct the coordinator directly with fakes.
 */
function createImportRuntime(
  media: ImportMediaPort & NativeWaveformPort = SnapCutMedia,
  repository: ProjectRepository = projectRepository,
): ImportRuntime {
  const waveformScheduler = new WaveformScheduler(media, repository, {
    onDiagnostic: (entry) => {
      void diagnosticLog.append('error', 'waveform.failed', {
        operation: entry.operation,
        status: entry.outcome,
        generation: entry.generation,
      });
    },
  });
  return {
    waveformScheduler,
    coordinator: new ImportCoordinator(media, repository, {
      waveformScheduler,
      onDiagnostic: (entry) => {
        void diagnosticLog.append('error', 'import.failed', {
          operation: entry.operation,
          stage: entry.stage,
          code: entry.code,
          generation: entry.generation,
          ...(entry.nativeStage === undefined ? {} : { nativeStage: entry.nativeStage }),
          ...(entry.causeCategory === undefined ? {} : { causeCategory: entry.causeCategory }),
          ...(entry.contractFields === undefined ? {} : { contractFields: entry.contractFields }),
        });
      },
    }),
  };
}

let activeImportRuntime: ImportRuntime | null = null;

export function getImportRuntime(): ImportRuntime {
  activeImportRuntime ??= createImportRuntime();
  return activeImportRuntime;
}

export function disposeImportRuntime(): void {
  void activeImportRuntime?.coordinator.cancelActive();
  void activeImportRuntime?.waveformScheduler.cancelAll();
  activeImportRuntime?.coordinator.dispose();
  activeImportRuntime?.waveformScheduler.dispose();
  activeImportRuntime = null;
}

export async function cancelActiveImportRuntime(): Promise<void> {
  await activeImportRuntime?.coordinator.cancelActive();
}

export async function cancelSourceWaveform(projectId: string, sourceId: string): Promise<void> {
  await activeImportRuntime?.waveformScheduler.cancel(projectId, sourceId);
}

/**
 * Prevents project deletion from racing an import commit or a waveform writer.
 * Heavy media work is process-wide and serialized, so deletion waits until the
 * shared queue is fully idle before repository files are removed.
 */
export async function prepareProjectMediaDeletion(
  runtime: ProjectMediaDeletionRuntime | null = activeImportRuntime,
): Promise<void> {
  if (!runtime) return;
  await runtime.coordinator.cancelActive();
  await runtime.waveformScheduler.cancelAll();
}

async function pauseImportRuntime(): Promise<void> {
  if (!activeImportRuntime) return;
  await Promise.all([
    activeImportRuntime.coordinator.pauseForBackground(),
    activeImportRuntime.waveformScheduler.cancelAll(),
  ]);
}

export type SnapCutAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

/**
 * Background transitions cancel media work. Returning to the foreground is a
 * deliberate no-op: version 1 never auto-resumes work cancelled in background.
 */
export async function handleMediaAppStateChange(
  state: SnapCutAppState,
  pause: () => Promise<void> = pauseImportRuntime,
): Promise<void> {
  if (state === 'active') return;
  await pause();
}

/** Cold-start recovery only. Do not call this from an AppState active event. */
export async function resumePendingWaveforms(
  repository: ProjectRepository = projectRepository,
): Promise<void> {
  await repository.initialize();
  const runtime = getImportRuntime();
  for (const project of repository.list()) {
    for (const source of project.sources) {
      if (source.waveformStatus === 'pending' || source.waveformStatus === 'processing') {
        runtime.waveformScheduler.schedule({ projectId: project.id, sourceId: source.id });
      }
    }
  }
}
