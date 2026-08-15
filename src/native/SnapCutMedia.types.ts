import type {
  AacProfile,
  ExportPreflightResult,
  FadeDurationMs,
  M4aExportPlan,
  SnapCutExportFormat,
  SnapCutExportMode,
  SourceKind,
} from '@/domain';

export const SNAP_CUT_MEDIA_ERROR_CODES = [
  'INVALID_REQUEST',
  'NATIVE_FEATURE_UNAVAILABLE',
  'SOURCE_NOT_FOUND',
  'SOURCE_PERMISSION_DENIED',
  'SOURCE_UNREADABLE',
  'SOURCE_TOO_LARGE',
  'NO_AUDIO_TRACK',
  'UNSUPPORTED_MEDIA',
  'UNSUPPORTED_AUDIO_CODEC',
  'UNSUPPORTED_CHANNEL_COUNT',
  'M4S_INIT_MISSING',
  'DRM_UNSUPPORTED',
  'CORRUPT_MEDIA',
  'DISK_SPACE_LOW',
  'OUTPUT_WRITE_FAILED',
  'PATH_OUTSIDE_PRIVATE_STORAGE',
  'OUTPUT_ALIASES_SOURCE',
  'IMPORT_CANCELLED',
  'IMPORT_VERIFICATION_FAILED',
  'WAVEFORM_DECODE_FAILED',
  'WAVEFORM_CANCELLED',
  'INVALID_CLIP_RANGE',
  'MISSING_SOURCE_FILE',
  'PREVIEW_PREPARE_FAILED',
  'PREVIEW_SEEK_FAILED',
  'JOB_ALREADY_RUNNING',
  'EXPORT_EMPTY_COMPOSITION',
  'EXPORT_FORMAT_UNAVAILABLE',
  'EXPORT_PREFLIGHT_FAILED',
  'M4A_NOT_ELIGIBLE',
  'M4A_PLAN_STALE',
  'M4A_INCOMPATIBLE_CODEC_CONFIG',
  'M4A_BOUNDARY_ALIGNMENT_FAILED',
  'M4A_MUX_FAILED',
  'M4A_VERIFICATION_FAILED',
  'AAC_ENCODER_INIT_FAILED',
  'AAC_ENCODER_FAILED',
  'AAC_VERIFICATION_FAILED',
  'EXPORT_DECODE_FAILED',
  'EXPORT_RESAMPLE_FAILED',
  'FLAC_ENCODER_INIT_FAILED',
  'FLAC_ENCODER_FAILED',
  'FLAC_VERIFICATION_FAILED',
  'MP3_ENCODER_INIT_FAILED',
  'MP3_ENCODER_FAILED',
  'MP3_VERIFICATION_FAILED',
  'EXPORT_MEDIASTORE_FAILED',
  'EXPORT_CANCELLED',
  'NATIVE_LIBRARY_LOAD_FAILED',
  'UNKNOWN_NATIVE_ERROR',
] as const;

export type SnapCutMediaErrorCode = (typeof SNAP_CUT_MEDIA_ERROR_CODES)[number];

export interface CodecLibraryStatus {
  version: string | null;
  available: boolean;
}

export interface CodecBuildInfo {
  moduleVersion: '1.0.0';
  media3: CodecLibraryStatus;
  flac: CodecLibraryStatus;
  lame: CodecLibraryStatus;
  libsamplerate: CodecLibraryStatus;
  nativeCodecBridgeLoaded: boolean;
}

export interface NativeHealth {
  moduleName: 'SnapCutMedia';
  moduleVersion: '1.0.0';
  platform: 'android';
  ready: boolean;
  mediaPipelineAvailable: boolean;
}

export interface PickedSource {
  sourceUri: string;
  suggestedName: string | null;
  suggestedMimeType: string | null;
  suggestedSizeBytes: number | null;
}

export interface InspectSourceRequest {
  jobId: string;
  generation: number;
  sourceUri: string;
  maxSourceBytes: number;
}

export interface SourceInspection {
  sourceKind: SourceKind;
  codecMime: string;
  durationMs: number;
  sampleRateHz: number;
  channelCount: 1 | 2;
  encodedBitrateBps: number | null;
  pcmBitsPerSample: 8 | 16 | 24 | 32 | null;
  aacProfile: AacProfile;
  codecConfigFingerprint: string | null;
  encoderDelayFrames: number | null;
  encoderPaddingFrames: number | null;
  fileSizeBytes: number | null;
  requiresStreamingSizeVerification: boolean;
  drmProtected: boolean;
}

export interface VerifyPrivateMediaRequest {
  fileUri: string;
}

export interface PrivateMediaVerificationResult {
  fileSizeBytes: number;
  sha256: string;
}

export interface ImportSourceRequest {
  jobId: string;
  generation: number;
  sourceUri: string;
  outputFileUri: string;
  maxSourceBytes: number;
}

export interface ImportResult extends Omit<
  SourceInspection,
  'fileSizeBytes' | 'drmProtected' | 'requiresStreamingSizeVerification'
> {
  outputFileUri: string;
  fileSizeBytes: number;
  privateAudioSha256: string;
}

export interface GenerateWaveformRequest {
  jobId: string;
  generation: number;
  sourceId: string;
  audioFileUri: string;
  outputWaveformFileUri: string;
  binCount: 8192;
}

export interface NativePreviewClip {
  clipId: string;
  sourceId: string;
  audioFileUri: string;
  startMs: number;
  endMs: number;
  trackId: 'track-1' | 'track-2';
  timelineStartMs: number;
  gain: number;
  fadeInMs: FadeDurationMs;
  fadeOutMs: FadeDurationMs;
}

export interface LoadPreviewRequest {
  playbackSessionId: string;
  generation: number;
  controlRevision: number;
  clips: NativePreviewClip[];
}

export interface PreviewCommandRequest {
  playbackSessionId: string;
  generation: number;
  controlRevision: number;
}

export interface SeekPreviewRequest extends PreviewCommandRequest {
  positionMs: number;
  resumeAfterSeek: boolean;
}

export interface ExportPreflightRequest {
  jobId: string;
  generation: number;
  projectId: string;
  clips: NativePreviewClip[];
}

export interface ExportAudioRequest {
  jobId: string;
  generation: number;
  projectId: string;
  format: SnapCutExportFormat;
  displayNameWithoutExtension: string;
  clips: NativePreviewClip[];
  outputSampleRateHz: 32_000 | 44_100 | 48_000 | null;
  outputChannelCount: 1 | 2 | null;
  m4aPlan: M4aExportPlan | null;
}

export interface ExportAudioResult {
  format: SnapCutExportFormat;
  mode: SnapCutExportMode;
  contentUri: string;
  displayName: string;
  requestedDurationMs: number;
  actualDurationMs: number;
  sampleRateHz: number;
  channelCount: 1 | 2;
  bitrateKbps: 160 | 320 | null;
  bitsPerSample: 24 | null;
  maxBoundaryAdjustmentMs: number;
  fileSizeBytes: number;
}

export interface ShareExportRequest {
  contentUri: string;
  format: SnapCutExportFormat;
}

export interface SnapCutMediaApi {
  getHealth(): NativeHealth;
  getCodecBuildInfo(): CodecBuildInfo;
  pickSource(): Promise<PickedSource | null>;
  inspectSource(request: InspectSourceRequest): Promise<SourceInspection>;
  verifyPrivateMedia(request: VerifyPrivateMediaRequest): Promise<PrivateMediaVerificationResult>;
  importSource(request: ImportSourceRequest): Promise<ImportResult>;
  cancelImport(jobId: string): Promise<void>;
  generateWaveform(request: GenerateWaveformRequest): Promise<void>;
  cancelWaveform(jobId: string): Promise<void>;
  loadSelectionPreview(request: LoadPreviewRequest): Promise<void>;
  loadCompositionPreview(request: LoadPreviewRequest): Promise<void>;
  playPreview(request: PreviewCommandRequest): Promise<void>;
  pausePreview(request: PreviewCommandRequest): Promise<void>;
  seekPreview(request: SeekPreviewRequest): Promise<void>;
  releasePreview(request: PreviewCommandRequest): Promise<void>;
  preflightExport(request: ExportPreflightRequest): Promise<ExportPreflightResult>;
  cancelExportPreflight(jobId: string): Promise<void>;
  exportAudio(request: ExportAudioRequest): Promise<ExportAudioResult>;
  cancelExport(jobId: string): Promise<void>;
  shareExport(request: ShareExportRequest): Promise<void>;
}

export interface SnapCutMediaSubscription {
  remove(): void;
}

export interface SnapCutMediaNativeModule extends SnapCutMediaApi {
  addListener(
    eventName: NativeEventName,
    listener: (event: unknown) => void,
  ): SnapCutMediaSubscription;
}

export type NativeEventName =
  | 'onImportProgress'
  | 'onWaveformProgress'
  | 'onPlaybackStatus'
  | 'onExportProgress'
  | 'onNativeError';
