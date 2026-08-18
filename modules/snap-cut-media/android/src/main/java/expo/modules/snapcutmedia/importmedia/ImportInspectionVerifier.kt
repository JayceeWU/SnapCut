package expo.modules.snapcutmedia.importmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.SourceInspection
import expo.modules.snapcutmedia.models.SourceKind
import kotlin.math.abs

/**
 * Verifies the stable properties of the committed private output.
 *
 * Android extractors and MediaMuxer are allowed to normalize container-level
 * hints such as encoder delay, encoder padding and PCM bit-depth metadata. Those
 * fields are not an integrity proof and must not reject an otherwise equivalent
 * audio track. Codec configuration, sample rate, channel count and duration
 * remain strict.
 */
internal object ImportInspectionVerifier {
  fun requireCompatible(
    before: SourceInspection,
    after: SourceInspection,
    expectedDurationMs: Long = before.durationMs
  ) {
    val expectedKind = when (before.sourceKind) {
      SourceKind.VIDEO_EXTRACTED_AAC,
      SourceKind.M4A,
      SourceKind.M4S_AAC -> SourceKind.M4A
      else -> before.sourceKind
    }
    requireField(after.sourceKind == expectedKind, "verification_source_kind")
    requireField(codecMimesCompatible(before.sourceKind, before.codecMime, after.codecMime), "verification_codec_mime")
    requireField(before.sampleRateHz == after.sampleRateHz, "verification_sample_rate")
    requireField(before.channelCount == after.channelCount, "verification_channel_count")

    if (before.sourceKind.isAac()) {
      requireField(before.aacProfile == after.aacProfile, "verification_aac_profile")
      requireField(
        before.codecConfigFingerprint != null && after.codecConfigFingerprint != null,
        "verification_codec_config"
      )
    }

    val durationToleranceMs = if (before.sourceKind.isAac()) {
      maxOf(100L, (2048L * 1000L) / before.sampleRateHz)
    } else {
      2L
    }
    requireField(
      abs(expectedDurationMs - after.durationMs) <= durationToleranceMs,
      "verification_duration"
    )
  }

  private fun codecMimesCompatible(kind: SourceKind, before: String, after: String): Boolean {
    val normalizedBefore = before.lowercase()
    val normalizedAfter = after.lowercase()
    val accepted = when (kind) {
      SourceKind.VIDEO_EXTRACTED_AAC,
      SourceKind.M4A,
      SourceKind.M4S_AAC -> AAC_MIMES
      SourceKind.MP3 -> MP3_MIMES
      SourceKind.FLAC -> FLAC_MIMES
      SourceKind.WAV -> WAV_MIMES
    }
    return normalizedBefore in accepted && normalizedAfter in accepted
  }

  private fun SourceKind.isAac(): Boolean = this in setOf(
    SourceKind.VIDEO_EXTRACTED_AAC,
    SourceKind.M4A,
    SourceKind.M4S_AAC
  )

  private fun requireField(condition: Boolean, technicalContext: String) {
    if (!condition) {
      throw mediaError(
        SnapCutMediaError.IMPORT_VERIFICATION_FAILED,
        technicalContext = technicalContext
      )
    }
  }

  private val AAC_MIMES = setOf("audio/mp4a-latm")
  private val MP3_MIMES = setOf("audio/mpeg", "audio/mp3")
  private val FLAC_MIMES = setOf("audio/flac", "audio/x-flac", "audio/raw")
  private val WAV_MIMES = setOf("audio/raw", "audio/wav", "audio/x-wav", "audio/vnd.wave")
}
