import type { SnapCutExportFormat, SnapCutExportMode } from '@/domain';
import type {
  NativeEventName,
  SnapCutMediaErrorCode,
  SnapCutMediaSubscription,
} from './SnapCutMedia.types';

export type NativeOperation = 'import' | 'waveform' | 'preflight' | 'export' | 'preview';

export interface NativeJobEvent {
  jobId: string;
  operation: NativeOperation;
  sequence: number;
  stage: string;
  generation: number;
}

export interface ProgressEvent extends NativeJobEvent {
  fraction: number | null;
  format?: SnapCutExportFormat;
}

export interface PlaybackStatusEvent extends NativeJobEvent {
  playbackSessionId: string;
  controlRevision: number;
  mode: 'selection' | 'composition';
  loaded: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  currentClipIndex: number | null;
  currentClipId: string | null;
  didJustFinish: boolean;
}

export interface NativeErrorEvent extends NativeJobEvent {
  code: SnapCutMediaErrorCode;
  message: string;
  nativeStage?: string;
  causeCategory?: 'provider' | 'extractor' | 'decoder' | 'job' | 'linkage' | 'native';
  format?: SnapCutExportFormat;
}

export interface ExportCompletedEvent extends NativeJobEvent {
  format: SnapCutExportFormat;
  mode: SnapCutExportMode;
}

export interface NativeEventMap {
  onImportProgress: ProgressEvent;
  onWaveformProgress: ProgressEvent;
  onPlaybackStatus: PlaybackStatusEvent;
  onExportProgress: ProgressEvent;
  onNativeError: NativeErrorEvent;
}

export interface SnapCutMediaEventApi {
  addEventListener<EventName extends NativeEventName>(
    eventName: EventName,
    listener: (event: NativeEventMap[EventName]) => void,
  ): SnapCutMediaSubscription;
}

export function isCurrentNativeEvent(
  event: Pick<NativeJobEvent, 'jobId' | 'generation'>,
  active: Pick<NativeJobEvent, 'jobId' | 'generation'> | null,
): boolean {
  return active !== null && event.jobId === active.jobId && event.generation === active.generation;
}
