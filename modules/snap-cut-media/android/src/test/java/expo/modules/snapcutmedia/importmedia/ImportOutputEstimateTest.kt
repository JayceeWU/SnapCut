package expo.modules.snapcutmedia.importmedia

import expo.modules.snapcutmedia.models.AacProfile
import expo.modules.snapcutmedia.models.SourceInspection
import expo.modules.snapcutmedia.models.SourceKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportOutputEstimateTest {
  @Test
  fun `video AAC estimate uses audio duration and track samples not full video size`() {
    val inspection = inspection(SourceKind.VIDEO_EXTRACTED_AAC, encodedBitrateBps = null)
    val measurement = TrackPayloadMeasurement(payloadBytes = 1_000_000L, sampleCount = 3_000L)

    val smallVideo = ImportOutputEstimate.estimate(inspection, 20_000_000L, measurement)
    val largeVideo = ImportOutputEstimate.estimate(inspection, 600L * 1024L * 1024L, measurement)

    assertEquals(smallVideo, largeVideo)
    assertTrue(largeVideo > measurement.payloadBytes)
    assertTrue(largeVideo < 20_000_000L)
  }

  @Test
  fun `audio only copies reserve their actual private source size`() {
    val sourceSize = 8_765_432L

    assertEquals(
      sourceSize,
      ImportOutputEstimate.estimate(
        inspection(SourceKind.MP3, encodedBitrateBps = 320_000L),
        sourceSize,
        null
      )
    )
  }

  private fun inspection(
    sourceKind: SourceKind,
    encodedBitrateBps: Long?
  ) = SourceInspection(
    sourceKind = sourceKind,
    codecMime = if (sourceKind == SourceKind.MP3) "audio/mpeg" else "audio/mp4a-latm",
    durationMs = 60_000L,
    sampleRateHz = 48_000,
    channelCount = 2,
    encodedBitrateBps = encodedBitrateBps,
    pcmBitsPerSample = null,
    aacProfile = if (sourceKind == SourceKind.MP3) null else AacProfile.AAC_LC,
    codecConfigFingerprint = if (sourceKind == SourceKind.MP3) null else "a".repeat(64),
    encoderDelayFrames = 0L,
    encoderPaddingFrames = 0L,
    fileSizeBytes = null,
    requiresStreamingSizeVerification = false,
    drmProtected = false
  )
}
