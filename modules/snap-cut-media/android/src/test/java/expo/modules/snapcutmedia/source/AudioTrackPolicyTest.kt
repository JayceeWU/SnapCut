package expo.modules.snapcutmedia.source

import android.media.MediaFormat
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.AacProfile
import expo.modules.snapcutmedia.models.SourceKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.nio.ByteBuffer

class AudioTrackPolicyTest {
  @Test
  fun `AAC content renamed M4S remains M4A when it is not fragmented`() {
    val selected = AudioTrackPolicy.select(
      listOf(candidate(mime = AudioTrackPolicy.MIME_AAC, aacProfile = AacProfile.AAC_LC)),
      hasVideo = false,
      probe = ContainerProbe(true, true, false, false),
      extractorHasDrm = false
    )

    assertEquals(SourceKind.M4A, selected.sourceKind)
  }

  @Test
  fun `fragmented AAC is classified from container content`() {
    val selected = AudioTrackPolicy.select(
      listOf(candidate(mime = AudioTrackPolicy.MIME_AAC, aacProfile = AacProfile.AAC_LC)),
      hasVideo = false,
      probe = ContainerProbe(true, true, true, false),
      extractorHasDrm = false
    )

    assertEquals(SourceKind.M4S_AAC, selected.sourceKind)
  }

  @Test
  fun `FLAC content is recognized from extractor MIME rather than extension`() {
    val selected = AudioTrackPolicy.select(
      listOf(candidate(mime = "audio/flac")),
      hasVideo = false,
      probe = ContainerProbe(false, false, false, false),
      extractorHasDrm = false
    )

    assertEquals(SourceKind.FLAC, selected.sourceKind)
  }

  @Test
  fun `MP3 extractor content remains MP3 when the provider name ends in M4S`() {
    // File names never enter AudioTrackPolicy; the extractor MIME is authoritative.
    val selected = AudioTrackPolicy.select(
      listOf(candidate(mime = "audio/mpeg")),
      hasVideo = false,
      probe = ContainerProbe(false, false, false, false),
      extractorHasDrm = false
    )

    assertEquals(SourceKind.MP3, selected.sourceKind)
  }

  @Test
  fun `video containers reject non AAC audio instead of copying the full video`() {
    listOf("audio/mpeg", "audio/flac", "audio/raw").forEach { mime ->
      val error = assertThrows(SnapCutMediaException::class.java) {
        AudioTrackPolicy.select(
          listOf(candidate(mime = mime, pcmBitsPerSample = 16)),
          hasVideo = true,
          probe = ContainerProbe(
            isIsoBmff = true,
            hasMovieBox = true,
            hasMovieFragmentBox = false,
            isWave = mime == "audio/raw"
          ),
          extractorHasDrm = false
        )
      }

      assertEquals("UNSUPPORTED_AUDIO_CODEC", error.code)
    }
  }

  @Test
  fun `video containers still classify decodable AAC as extracted audio`() {
    val selected = AudioTrackPolicy.select(
      listOf(candidate(mime = AudioTrackPolicy.MIME_AAC, aacProfile = AacProfile.AAC_LC)),
      hasVideo = true,
      probe = ContainerProbe(true, true, false, false),
      extractorHasDrm = false
    )

    assertEquals(SourceKind.VIDEO_EXTRACTED_AAC, selected.sourceKind)
  }

  @Test
  fun `DRM and unsupported channels use stable errors`() {
    val drm = assertThrows(SnapCutMediaException::class.java) {
      AudioTrackPolicy.select(
        listOf(candidate(mime = "audio/mpeg")),
        hasVideo = false,
        probe = ContainerProbe(false, false, false, false),
        extractorHasDrm = true
      )
    }
    val channels = assertThrows(SnapCutMediaException::class.java) {
      AudioTrackPolicy.select(
        listOf(candidate(mime = "audio/mpeg", channelCount = 6)),
        hasVideo = false,
        probe = ContainerProbe(false, false, false, false),
        extractorHasDrm = false
      )
    }
    assertEquals("DRM_UNSUPPORTED", drm.code)
    assertEquals("UNSUPPORTED_CHANNEL_COUNT", channels.code)
  }

  @Test
  fun `audio specific config extracts AAC LC object type`() {
    assertEquals(2, AacCodecData.objectTypeFromAudioSpecificConfig(ByteBuffer.wrap(byteArrayOf(0x12, 0x10))))
  }

  private fun candidate(
    mime: String,
    channelCount: Int = 2,
    aacProfile: AacProfile? = null,
    pcmBitsPerSample: Int? = null
  ) = AudioTrackCandidate(
    index = 0,
    format = MediaFormat(),
    mime = mime,
    durationUs = 1_000_000L,
    sampleRateHz = 44_100,
    channelCount = channelCount,
    encodedBitrateBps = 320_000L,
    pcmBitsPerSample = pcmBitsPerSample,
    aacProfile = aacProfile,
    aacObjectType = if (aacProfile == null) null else 2,
    codecConfigFingerprint = if (aacProfile == null) null else "a".repeat(64),
    encoderDelayFrames = 0L,
    encoderPaddingFrames = 0L,
    encrypted = false,
    decoderAvailable = true
  )
}
