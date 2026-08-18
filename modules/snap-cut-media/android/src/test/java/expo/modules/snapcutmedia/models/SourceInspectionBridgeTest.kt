package expo.modules.snapcutmedia.models

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class SourceInspectionBridgeTest {
  @Test
  fun bridgeMapUsesStablePrimitiveValuesAndExplicitNulls() {
    val value = SourceInspection(
      sourceKind = SourceKind.VIDEO_EXTRACTED_AAC,
      codecMime = "audio/mp4a-latm",
      durationMs = 12_345L,
      sampleRateHz = 48_000,
      channelCount = 2,
      encodedBitrateBps = 192_000L,
      pcmBitsPerSample = null,
      aacProfile = AacProfile.AAC_LC,
      codecConfigFingerprint = "a".repeat(64),
      encoderDelayFrames = 0L,
      encoderPaddingFrames = null,
      fileSizeBytes = 500L,
      requiresStreamingSizeVerification = false,
      drmProtected = false
    ).toBridgeMap()

    assertEquals(SourceInspectionBridgeContract.FIELD_NAMES, value.keys.toList())
    assertEquals("video-extracted-aac", value["sourceKind"])
    assertEquals("aac-lc", value["aacProfile"])
    assertEquals(12_345L, value["durationMs"])
    assertNull(value["pcmBitsPerSample"])
    assertNull(value["encoderPaddingFrames"])
    assertFalse(value["requiresStreamingSizeVerification"] as Boolean)
  }

  @Test
  fun importedResultBridgeMapUsesContractStringsAndEchoesTheExactOutputUri() {
    val outputUri = "file:/data/user/0/com.snapcut.app/files/staging/source.m4a.partial"
    val value = ImportedSourceResult(
      outputFileUri = outputUri,
      sourceKind = SourceKind.VIDEO_EXTRACTED_AAC,
      codecMime = "audio/mp4a-latm",
      durationMs = 12_301L,
      sampleRateHz = 48_000,
      channelCount = 2,
      encodedBitrateBps = 192_000L,
      pcmBitsPerSample = null,
      aacProfile = AacProfile.AAC_LC,
      codecConfigFingerprint = "b".repeat(64),
      encoderDelayFrames = null,
      encoderPaddingFrames = null,
      fileSizeBytes = 450L,
      privateAudioSha256 = "c".repeat(64)
    ).toBridgeMap()

    assertEquals(ImportedSourceResultBridgeContract.FIELD_NAMES, value.keys.toList())
    assertEquals(outputUri, value["outputFileUri"])
    assertEquals("video-extracted-aac", value["sourceKind"])
    assertEquals("aac-lc", value["aacProfile"])
    assertEquals(12_301L, value["durationMs"])
    assertNull(value["pcmBitsPerSample"])
    assertNull(value["encoderDelayFrames"])
  }
}
