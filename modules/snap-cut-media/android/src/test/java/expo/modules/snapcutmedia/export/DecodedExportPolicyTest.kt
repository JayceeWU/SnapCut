package expo.modules.snapcutmedia.export

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.ExportAudioRequest
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.models.NativePreviewClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DecodedExportPolicyTest {
  @Test
  fun `sample rate policy preserves common supported rate`() {
    assertEquals(
      32_000,
      DecodedExportPolicy.selectOutputSampleRate(
        listOf(DecodedSourceFormat(32_000, 1), DecodedSourceFormat(32_000, 2))
      )
    )
  }

  @Test
  fun `mixed rates choose 48k only when a source is at least 48k`() {
    assertEquals(
      48_000,
      DecodedExportPolicy.selectOutputSampleRate(
        listOf(DecodedSourceFormat(44_100, 1), DecodedSourceFormat(96_000, 1))
      )
    )
    assertEquals(
      44_100,
      DecodedExportPolicy.selectOutputSampleRate(
        listOf(DecodedSourceFormat(22_050, 1), DecodedSourceFormat(32_000, 1))
      )
    )
  }

  @Test
  fun `channel policy preserves mono only when every clip is mono`() {
    assertEquals(
      1,
      DecodedExportPolicy.selectOutputChannelCount(listOf(DecodedSourceFormat(44_100, 1)))
    )
    assertEquals(
      2,
      DecodedExportPolicy.selectOutputChannelCount(
        listOf(DecodedSourceFormat(44_100, 1), DecodedSourceFormat(44_100, 2))
      )
    )
  }

  @Test
  fun `native decoded export rejects a stale preflight selection`() {
    val error = assertThrows(SnapCutMediaException::class.java) {
      DecodedExportPolicy.requireMatchingRequest(
        request(outputRate = 44_100, outputChannels = 1),
        listOf(DecodedSourceFormat(48_000, 2))
      )
    }
    assertEquals(SnapCutMediaError.EXPORT_PREFLIGHT_FAILED, error.error)
  }

  private fun request(outputRate: Int, outputChannels: Int) = ExportAudioRequest(
    jobId = "job-1",
    generation = 1,
    projectId = "project-1",
    format = ExportFormat.FLAC,
    displayNameWithoutExtension = "Export",
    clips = listOf(NativePreviewClip("clip-1", "source-1", "file:/source.m4a", 0, 100)),
    outputSampleRateHz = outputRate,
    outputChannelCount = outputChannels,
    m4aPlan = null
  )
}
