export type SourceKind = 'video-extracted-aac' | 'm4a' | 'm4s-aac' | 'mp3' | 'flac' | 'wav';

export type AacProfile = 'aac-lc' | 'he-aac-v1' | 'he-aac-v2' | null;

export type WaveformStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type FadeDurationMs =
  | 0
  | 500
  | 1000
  | 1500
  | 2000
  | 2500
  | 3000
  | 3500
  | 4000
  | 4500
  | 5000
  | 5500
  | 6000
  | 6500
  | 7000
  | 7500
  | 8000;

export type CrossfadeDurationMs = 1000 | 2000 | 4000 | 6000 | 8000;

export interface SnapCutSource {
  id: string;
  displayName: string;
  originalMimeType: string | null;
  sourceKind: SourceKind;
  privateAudioFileName: string;
  durationMs: number;
  codecMime: string;
  sampleRateHz: number;
  channelCount: 1 | 2;
  encodedBitrateBps: number | null;
  pcmBitsPerSample: 8 | 16 | 24 | 32 | null;
  fileSizeBytes: number;
  waveformFileName: string;
  waveformStatus: WaveformStatus;
  createdAt: string;
  aacProfile: AacProfile;
  codecConfigFingerprint: string | null;
  encoderDelayFrames: number | null;
  encoderPaddingFrames: number | null;
  privateAudioSha256: string | null;
}

export interface SnapCutClip {
  id: string;
  sourceId: string;
  startMs: number;
  endMs: number;
}

export type SnapCutExportFormat = 'm4a' | 'mp3';

export type SnapCutExportMode = 'aac-stream-copy' | 'aac-lossy-encode' | 'mp3-lossy-encode';

export interface SnapCutExportRecord {
  format: SnapCutExportFormat;
  mode: SnapCutExportMode;
  displayName: string;
  contentUri: string;
  exportedAt: string;
  requestedDurationMs: number;
  actualDurationMs: number;
  sampleRateHz: number;
  channelCount: 1 | 2;
  bitrateKbps: 160 | 320 | null;
  maxBoundaryAdjustmentMs: number;
  fileSizeBytes: number;
}

export interface SourceComparisonBookmark {
  sourceId: string;
  firstMs: number;
  secondMs: number;
}

export interface SnapCutCrossfade {
  id: string;
  leftClipId: string;
  rightClipId: string;
  durationMs: CrossfadeDurationMs;
}

export interface SnapCutProject {
  schemaVersion: 9;
  id: string;
  name: string;
  namePromptCompleted: boolean;
  createdAt: string;
  updatedAt: string;
  sources: SnapCutSource[];
  clips: SnapCutClip[];
  sourceComparisons: SourceComparisonBookmark[];
  crossfades: SnapCutCrossfade[];
  lastExport: SnapCutExportRecord | null;
}

export type ImmutableSourceManifest = Omit<
  SnapCutSource,
  'displayName' | 'waveformFileName' | 'waveformStatus'
>;

export interface SourceFile {
  schemaVersion: 2;
  projectId: string;
  source: ImmutableSourceManifest;
}

export interface WaveformFile {
  schemaVersion: 1;
  durationMs: number;
  binCount: 8192;
  rms: number[];
  peak: number[];
}

export interface M4aPlannedClip {
  clipId: string;
  sourceId: string;
  requestedStartMs: number;
  requestedEndMs: number;
  effectiveStartUs: number;
  effectiveEndUs: number;
  startAdjustmentMs: number;
  endAdjustmentMs: number;
  estimatedEncodedBytes: number;
}

export interface M4aSourceSnapshot {
  sourceId: string;
  privateAudioSha256: string;
  codecConfigFingerprint: string | null;
  fileSizeBytes: number;
  lastModifiedEpochMs: number;
}

export interface M4aExportPlan {
  planVersion: 1;
  planId: string;
  createdAt: string;
  eligible: boolean;
  reasons: string[];
  codecConfigFingerprint: string | null;
  sampleRateHz: number | null;
  channelCount: 1 | 2 | null;
  maxBoundaryAdjustmentMs: number;
  estimatedOutputBytes: number | null;
  sourceSnapshots: M4aSourceSnapshot[];
  clips: M4aPlannedClip[];
}

export interface ExportFormatAvailability {
  format: SnapCutExportFormat;
  mode: SnapCutExportMode | null;
  available: boolean;
  reasons: string[];
  estimatedOutputBytes: number | null;
  requiredFreeBytes: number | null;
  sampleRateHz: number | null;
  channelCount: 1 | 2 | null;
}

export interface ExportPreflightResult {
  contractVersion: 1;
  preferredFormat: SnapCutExportFormat;
  m4aPlan: M4aExportPlan;
  formats: ExportFormatAvailability[];
  mayClip: boolean;
}

export interface ClipTimelineEntry {
  clipId: string;
  compositionStartMs: number;
  compositionEndMs: number;
}

export interface TimelinePosition {
  clipId: string;
  clipIndex: number;
  positionInClipMs: number;
  sourcePositionMs: number;
  compositionPositionMs: number;
}
