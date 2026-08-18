package expo.modules.snapcutmedia.errors

import expo.modules.kotlin.exception.CodedException

internal enum class SnapCutMediaError(
  val code: String,
  val safeMessage: String
) {
  INVALID_REQUEST("INVALID_REQUEST", "The native media request is invalid."),
  NATIVE_FEATURE_UNAVAILABLE(
    "NATIVE_FEATURE_UNAVAILABLE",
    "This media feature is not available in the installed build."
  ),
  SOURCE_NOT_FOUND("SOURCE_NOT_FOUND", "The selected media could not be found."),
  SOURCE_PERMISSION_DENIED(
    "SOURCE_PERMISSION_DENIED",
    "SnapCut no longer has permission to read the selected media."
  ),
  SOURCE_UNREADABLE("SOURCE_UNREADABLE", "The selected media cannot be opened."),
  SOURCE_TOO_LARGE("SOURCE_TOO_LARGE", "The selected media is larger than 600 MiB."),
  NO_AUDIO_TRACK("NO_AUDIO_TRACK", "The selected media does not contain a readable audio track."),
  UNSUPPORTED_MEDIA("UNSUPPORTED_MEDIA", "This media format is not supported on this device."),
  UNSUPPORTED_AUDIO_CODEC(
    "UNSUPPORTED_AUDIO_CODEC",
    "The selected audio codec is not supported on this device."
  ),
  UNSUPPORTED_CHANNEL_COUNT(
    "UNSUPPORTED_CHANNEL_COUNT",
    "SnapCut supports only mono and stereo sources."
  ),
  M4S_INIT_MISSING(
    "M4S_INIT_MISSING",
    "The selected M4S fragment cannot be opened without its initialization segment."
  ),
  DRM_UNSUPPORTED("DRM_UNSUPPORTED", "Protected media is not supported."),
  CORRUPT_MEDIA("CORRUPT_MEDIA", "The selected media is damaged or incomplete."),
  DISK_SPACE_LOW("DISK_SPACE_LOW", "There is not enough device storage for this operation."),
  OUTPUT_WRITE_FAILED("OUTPUT_WRITE_FAILED", "The private media output could not be written."),
  PATH_OUTSIDE_PRIVATE_STORAGE(
    "PATH_OUTSIDE_PRIVATE_STORAGE",
    "The output must be inside SnapCut private staging storage."
  ),
  OUTPUT_ALIASES_SOURCE(
    "OUTPUT_ALIASES_SOURCE",
    "The output path must not refer to the selected source."
  ),
  IMPORT_CANCELLED("IMPORT_CANCELLED", "The import was cancelled."),
  IMPORT_VERIFICATION_FAILED(
    "IMPORT_VERIFICATION_FAILED",
    "The imported private media could not be verified."
  ),
  WAVEFORM_DECODE_FAILED("WAVEFORM_DECODE_FAILED", "The waveform could not be generated."),
  WAVEFORM_CANCELLED("WAVEFORM_CANCELLED", "Waveform generation was cancelled."),
  INVALID_CLIP_RANGE("INVALID_CLIP_RANGE", "A clip contains an invalid time range."),
  MISSING_SOURCE_FILE("MISSING_SOURCE_FILE", "A project source file is missing."),
  PREVIEW_PREPARE_FAILED("PREVIEW_PREPARE_FAILED", "Audio preview could not be prepared."),
  PREVIEW_SEEK_FAILED("PREVIEW_SEEK_FAILED", "Audio preview could not seek to that position."),
  JOB_ALREADY_RUNNING("JOB_ALREADY_RUNNING", "Another media operation is already running."),
  EXPORT_EMPTY_COMPOSITION("EXPORT_EMPTY_COMPOSITION", "Add at least one clip before exporting."),
  EXPORT_FORMAT_UNAVAILABLE(
    "EXPORT_FORMAT_UNAVAILABLE",
    "The selected export format is unavailable for this composition."
  ),
  EXPORT_PREFLIGHT_FAILED("EXPORT_PREFLIGHT_FAILED", "The composition could not be checked."),
  M4A_NOT_ELIGIBLE("M4A_NOT_ELIGIBLE", "This composition cannot use M4A stream copy."),
  M4A_PLAN_STALE("M4A_PLAN_STALE", "The M4A plan is stale. Reopen the export screen."),
  M4A_INCOMPATIBLE_CODEC_CONFIG(
    "M4A_INCOMPATIBLE_CODEC_CONFIG",
    "The selected AAC sources use incompatible codec configurations."
  ),
  M4A_BOUNDARY_ALIGNMENT_FAILED(
    "M4A_BOUNDARY_ALIGNMENT_FAILED",
    "A cut point cannot be aligned safely to an AAC frame boundary."
  ),
  M4A_MUX_FAILED("M4A_MUX_FAILED", "The M4A file could not be created."),
  M4A_VERIFICATION_FAILED("M4A_VERIFICATION_FAILED", "The M4A output could not be verified."),
  AAC_ENCODER_INIT_FAILED("AAC_ENCODER_INIT_FAILED", "The AAC encoder could not start."),
  AAC_ENCODER_FAILED("AAC_ENCODER_FAILED", "AAC encoding failed."),
  AAC_VERIFICATION_FAILED("AAC_VERIFICATION_FAILED", "The AAC output could not be verified."),
  EXPORT_DECODE_FAILED("EXPORT_DECODE_FAILED", "A clip could not be decoded for export."),
  EXPORT_RESAMPLE_FAILED("EXPORT_RESAMPLE_FAILED", "Audio resampling failed."),
  MP3_ENCODER_INIT_FAILED("MP3_ENCODER_INIT_FAILED", "The MP3 encoder could not start."),
  MP3_ENCODER_FAILED("MP3_ENCODER_FAILED", "MP3 encoding failed."),
  MP3_VERIFICATION_FAILED("MP3_VERIFICATION_FAILED", "The MP3 output could not be verified."),
  EXPORT_MEDIASTORE_FAILED(
    "EXPORT_MEDIASTORE_FAILED",
    "The completed audio could not be saved to Music/SnapCut."
  ),
  EXPORT_CANCELLED("EXPORT_CANCELLED", "The export was cancelled."),
  NATIVE_LIBRARY_LOAD_FAILED(
    "NATIVE_LIBRARY_LOAD_FAILED",
    "The native audio codec libraries are unavailable in this build."
  ),
  UNKNOWN_NATIVE_ERROR("UNKNOWN_NATIVE_ERROR", "The native media operation failed.")
}
internal class SnapCutMediaException(
  val error: SnapCutMediaError,
  val technicalContext: String? = null,
  cause: Throwable? = null
) : CodedException(error.code, error.safeMessage, cause)

internal fun mediaError(
  error: SnapCutMediaError,
  technicalContext: String? = null,
  cause: Throwable? = null
): SnapCutMediaException = SnapCutMediaException(error, technicalContext, cause)
