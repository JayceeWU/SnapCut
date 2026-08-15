package expo.modules.snapcutmedia.models

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.Enumerable
import expo.modules.kotlin.types.OptimizedRecord

enum class SourceKind(val value: String) : Enumerable {
  VIDEO_EXTRACTED_AAC("video-extracted-aac"),
  M4A("m4a"),
  M4S_AAC("m4s-aac"),
  MP3("mp3"),
  FLAC("flac"),
  WAV("wav")
}

enum class AacProfile(val value: String) : Enumerable {
  AAC_LC("aac-lc"),
  HE_AAC_V1("he-aac-v1"),
  HE_AAC_V2("he-aac-v2")
}

enum class ExportFormat(val value: String) : Enumerable {
  M4A("m4a"),
  FLAC("flac"),
  MP3("mp3")
}

enum class TrackId(val value: String) : Enumerable {
  TRACK_1("track-1"),
  TRACK_2("track-2")
}

enum class NativeOperation(val value: String) : Enumerable {
  IMPORT("import"),
  WAVEFORM("waveform"),
  PREFLIGHT("preflight"),
  EXPORT("export"),
  PREVIEW("preview")
}

@OptimizedRecord
data class PickedSource(
  @Field val sourceUri: String,
  @Field val suggestedName: String?,
  @Field val suggestedMimeType: String?,
  @Field val suggestedSizeBytes: Long?
) : Record

@OptimizedRecord
data class InspectSourceRequest(
  @Field val jobId: String,
  @Field val generation: Long,
  @Field val sourceUri: String,
  @Field val maxSourceBytes: Long
) : Record

@OptimizedRecord
data class VerifyPrivateMediaRequest(
  @Field val fileUri: String
) : Record

@OptimizedRecord
data class PrivateMediaVerificationResult(
  @Field val fileSizeBytes: Long,
  @Field val sha256: String
) : Record

@OptimizedRecord
data class SourceInspection(
  @Field val sourceKind: SourceKind,
  @Field val codecMime: String,
  @Field val durationMs: Long,
  @Field val sampleRateHz: Int,
  @Field val channelCount: Int,
  @Field val encodedBitrateBps: Long?,
  @Field val pcmBitsPerSample: Int?,
  @Field val aacProfile: AacProfile?,
  @Field val codecConfigFingerprint: String?,
  @Field val encoderDelayFrames: Long?,
  @Field val encoderPaddingFrames: Long?,
  @Field val fileSizeBytes: Long?,
  @Field val requiresStreamingSizeVerification: Boolean,
  @Field val drmProtected: Boolean
) : Record

@OptimizedRecord
data class ImportSourceRequest(
  @Field val jobId: String,
  @Field val generation: Long,
  @Field val sourceUri: String,
  @Field val outputFileUri: String,
  @Field val maxSourceBytes: Long
) : Record

@OptimizedRecord
data class ImportedSourceResult(
  @Field val outputFileUri: String,
  @Field val sourceKind: SourceKind,
  @Field val codecMime: String,
  @Field val durationMs: Long,
  @Field val sampleRateHz: Int,
  @Field val channelCount: Int,
  @Field val encodedBitrateBps: Long?,
  @Field val pcmBitsPerSample: Int?,
  @Field val aacProfile: AacProfile?,
  @Field val codecConfigFingerprint: String?,
  @Field val encoderDelayFrames: Long?,
  @Field val encoderPaddingFrames: Long?,
  @Field val fileSizeBytes: Long,
  @Field val privateAudioSha256: String
) : Record

@OptimizedRecord
data class GenerateWaveformRequest(
  @Field val jobId: String,
  @Field val generation: Long,
  @Field val sourceId: String,
  @Field val audioFileUri: String,
  @Field val outputWaveformFileUri: String,
  @Field val binCount: Int
) : Record

@OptimizedRecord
data class NativePreviewClip(
  @Field val clipId: String,
  @Field val sourceId: String,
  @Field val audioFileUri: String,
  @Field val startMs: Long,
  @Field val endMs: Long,
  @Field val trackId: TrackId = TrackId.TRACK_1,
  @Field val timelineStartMs: Long = 0L,
  @Field val gain: Double = 1.0,
  @Field val fadeInMs: Long = 0L,
  @Field val fadeOutMs: Long = 0L
) : Record

@OptimizedRecord
data class LoadPreviewRequest(
  @Field val playbackSessionId: String,
  @Field val generation: Long,
  @Field val controlRevision: Long,
  @Field val clips: List<NativePreviewClip>
) : Record

@OptimizedRecord
data class PreviewCommandRequest(
  @Field val playbackSessionId: String,
  @Field val generation: Long,
  @Field val controlRevision: Long
) : Record

@OptimizedRecord
data class SeekPreviewRequest(
  @Field val playbackSessionId: String,
  @Field val generation: Long,
  @Field val controlRevision: Long,
  @Field val positionMs: Long,
  @Field val resumeAfterSeek: Boolean
) : Record

@OptimizedRecord
data class ExportPreflightRequest(
  @Field val jobId: String,
  @Field val generation: Long,
  @Field val projectId: String,
  @Field val clips: List<NativePreviewClip>
) : Record

@OptimizedRecord
data class M4aSourceSnapshot(
  @Field val sourceId: String,
  @Field val privateAudioSha256: String,
  @Field val codecConfigFingerprint: String?,
  @Field val fileSizeBytes: Long,
  @Field val lastModifiedEpochMs: Long
) : Record

@OptimizedRecord
data class M4aPlannedClip(
  @Field val clipId: String,
  @Field val sourceId: String,
  @Field val requestedStartMs: Long,
  @Field val requestedEndMs: Long,
  @Field val effectiveStartUs: Long,
  @Field val effectiveEndUs: Long,
  @Field val startAdjustmentMs: Long,
  @Field val endAdjustmentMs: Long,
  @Field val estimatedEncodedBytes: Long
) : Record

@OptimizedRecord
data class M4aExportPlan(
  @Field val planVersion: Int,
  @Field val planId: String,
  @Field val createdAt: String,
  @Field val eligible: Boolean,
  @Field val reasons: List<String>,
  @Field val codecConfigFingerprint: String?,
  @Field val sampleRateHz: Int?,
  @Field val channelCount: Int?,
  @Field val maxBoundaryAdjustmentMs: Long,
  @Field val estimatedOutputBytes: Long?,
  @Field val sourceSnapshots: List<M4aSourceSnapshot>,
  @Field val clips: List<M4aPlannedClip>
) : Record

@OptimizedRecord
data class ExportAudioRequest(
  @Field val jobId: String,
  @Field val generation: Long,
  @Field val projectId: String,
  @Field val format: ExportFormat,
  @Field val displayNameWithoutExtension: String,
  @Field val clips: List<NativePreviewClip>,
  @Field val outputSampleRateHz: Int?,
  @Field val outputChannelCount: Int?,
  @Field val m4aPlan: M4aExportPlan?
) : Record

@OptimizedRecord
data class ShareExportRequest(
  @Field val contentUri: String,
  @Field val format: ExportFormat
) : Record

@OptimizedRecord
data class NativeJobEvent(
  @Field val jobId: String,
  @Field val operation: NativeOperation,
  @Field val sequence: Long,
  @Field val stage: String,
  @Field val generation: Long,
  @Field val fraction: Double?
) : Record
