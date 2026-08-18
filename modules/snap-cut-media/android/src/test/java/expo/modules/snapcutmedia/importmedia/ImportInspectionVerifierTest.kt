package expo.modules.snapcutmedia.importmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.AacProfile
import expo.modules.snapcutmedia.models.SourceInspection
import expo.modules.snapcutmedia.models.SourceKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ImportInspectionVerifierTest {
  @Test
  fun acceptsAacRemuxWhenContainerOnlyGaplessHintsChange() {
    val before = inspection(
      kind = SourceKind.VIDEO_EXTRACTED_AAC,
      mime = "audio/mp4a-latm",
      encoderDelayFrames = 2_112L,
      encoderPaddingFrames = 960L
    )
    val after = before.copy(
      sourceKind = SourceKind.M4A,
      durationMs = before.durationMs - 2_000L,
      codecConfigFingerprint = "b".repeat(64),
      encoderDelayFrames = null,
      encoderPaddingFrames = null
    )

    ImportInspectionVerifier.requireCompatible(
      before,
      after,
      expectedDurationMs = after.durationMs - 80L
    )
  }

  @Test
  fun acceptsExtractorMimeAliasesForCopiedSources() {
    ImportInspectionVerifier.requireCompatible(
      inspection(SourceKind.MP3, "audio/mpeg"),
      inspection(SourceKind.MP3, "audio/mp3")
    )
    ImportInspectionVerifier.requireCompatible(
      inspection(SourceKind.FLAC, "audio/flac", pcmBits = 24),
      inspection(SourceKind.FLAC, "audio/raw", pcmBits = null)
    )
  }

  @Test
  fun reportsMissingFinalCodecConfiguration() {
    val before = inspection(SourceKind.M4A, "audio/mp4a-latm")
    val after = before.copy(
      sourceKind = SourceKind.M4A,
      codecConfigFingerprint = null
    )

    val error = assertThrows(SnapCutMediaException::class.java) {
      ImportInspectionVerifier.requireCompatible(before, after)
    }
    assertEquals("IMPORT_VERIFICATION_FAILED", error.code)
    assertEquals("verification_codec_config", error.technicalContext)
  }

  @Test
  fun rejectsMaterialDurationMismatch() {
    val before = inspection(SourceKind.WAV, "audio/raw", pcmBits = 16)
    val after = before.copy(durationMs = before.durationMs + 3L)

    val error = assertThrows(SnapCutMediaException::class.java) {
      ImportInspectionVerifier.requireCompatible(before, after)
    }
    assertEquals("verification_duration", error.technicalContext)
  }

  private fun inspection(
    kind: SourceKind,
    mime: String,
    pcmBits: Int? = null,
    encoderDelayFrames: Long? = null,
    encoderPaddingFrames: Long? = null
  ) = SourceInspection(
    sourceKind = kind,
    codecMime = mime,
    durationMs = 185_514L,
    sampleRateHz = 48_000,
    channelCount = 2,
    encodedBitrateBps = 192_000L,
    pcmBitsPerSample = pcmBits,
    aacProfile = if (kind in AAC_KINDS) AacProfile.AAC_LC else null,
    codecConfigFingerprint = if (kind in AAC_KINDS) "a".repeat(64) else null,
    encoderDelayFrames = encoderDelayFrames,
    encoderPaddingFrames = encoderPaddingFrames,
    fileSizeBytes = 1_024L,
    requiresStreamingSizeVerification = false,
    drmProtected = false
  )

  private companion object {
    val AAC_KINDS = setOf(SourceKind.VIDEO_EXTRACTED_AAC, SourceKind.M4A, SourceKind.M4S_AAC)
  }
}
