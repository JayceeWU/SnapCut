export type SourceKind = 'video-extracted-aac' | 'm4a' | 'm4s-aac' | 'mp3' | 'flac' | 'wav';

export type AacProfile = 'aac-lc' | 'he-aac-v1' | 'he-aac-v2' | null;

export type WaveformStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type TrackId = 'track-1' | 'track-2';

export type LegacyFadeDurationMs = 0 | 500 | 1000 | 1500 | 2000 | 3000 | 4000;

export type FadeDurationMs =
  0 | 500 | 1000 | 1500 | 2000 | 2500 | 3000 | 3500 | 4000 | 4500 | 5000 | 5500 | 6000;

export interface SnapCutSourceV1 {
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
}

export interface SnapCutSource extends SnapCutSourceV1 {
  aacProfile: AacProfile;
  codecConfigFingerprint: string | null;
  encoderDelayFrames: number | null;
  encoderPaddingFrames: number | null;
  privateAudioSha256: string | null;
}

export interface SnapCutClipV1 {
  id: string;
  sourceId: string;
  startMs: number;
  endMs: number;
}

export interface SnapCutClipV5 extends SnapCutClipV1 {
  trackId: TrackId;
  timelineStartMs: number;
  gain: number;
  fadeInMs: LegacyFadeDurationMs;
  fadeOutMs: LegacyFadeDurationMs;
}

export interface SnapCutClip extends Omit<SnapCutClipV5, 'fadeInMs' | 'fadeOutMs'> {
  fadeInMs: FadeDurationMs;
  fadeOutMs: FadeDurationMs;
}

export type SnapCutExportFormat = 'm4a' | 'flac' | 'mp3';

export type SnapCutExportMode =
  'aac-stream-copy' | 'aac-lossy-encode' | 'flac-lossless-encode' | 'mp3-lossy-encode';

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
  bitsPerSample: 24 | null;
  maxBoundaryAdjustmentMs: number;
  fileSizeBytes: number;
}

export interface SnapCutProjectV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sources: SnapCutSourceV1[];
  clips: SnapCutClipV1[];
  lastExport: SnapCutExportRecord | null;
}

export interface SnapCutProjectV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sources: SnapCutSource[];
  clips: SnapCutClipV1[];
  lastExport: SnapCutExportRecord | null;
}

export interface SnapCutProjectV3 extends Omit<SnapCutProjectV2, 'schemaVersion'> {
  schemaVersion: 3;
  namePromptCompleted: boolean;
}

export interface SnapCutProjectV4 extends Omit<SnapCutProjectV3, 'schemaVersion' | 'clips'> {
  schemaVersion: 4;
  trackCount: 1 | 2;
  clips: SnapCutClipV5[];
}

export interface SnapCutProjectV5 extends Omit<SnapCutProjectV4, 'schemaVersion' | 'trackCount'> {
  schemaVersion: 5;
  trackCount: 2;
}

export interface SnapCutProject extends Omit<SnapCutProjectV5, 'schemaVersion' | 'clips'> {
  schemaVersion: 6;
  clips: SnapCutClip[];
}

export interface SourceFileV1 {
  schemaVersion: 1;
  projectId: string;
  source: SnapCutSource;
}

export interface WaveformFileV1 {
  schemaVersion: 1;
  durationMs: number;
  binCount: 8192;
  rms: number[];
  peak: number[];
}

export interface ProjectIndexEntry {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceCount: number;
  clipCount: number;
  compositionDurationMs: number;
}

export interface ProjectIndexFileV1 {
  schemaVersion: 1;
  projects: ProjectIndexEntry[];
}

export type ProjectIndex = ProjectIndexFileV1;

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
  preferredFormat: 'm4a' | 'flac';
  m4aPlan: M4aExportPlan;
  formats: ExportFormatAvailability[];
  mayClip: boolean;
}

export interface ClipTimelineEntry {
  clipId: string;
  trackId: TrackId;
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
