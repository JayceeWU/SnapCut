package expo.modules.snapcutmedia.export

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.ExportAudioRequest
import expo.modules.snapcutmedia.models.ExportFormat

internal data class DecodedSourceFormat(
  val sampleRateHz: Int,
  val channelCount: Int
)

internal object DecodedExportPolicy {
  fun selectOutputSampleRate(formats: List<DecodedSourceFormat>): Int {
    require(formats.isNotEmpty())
    val rates = formats.map(DecodedSourceFormat::sampleRateHz)
    require(rates.all { it in 8_000..384_000 })
    val single = rates.distinct().singleOrNull()
    if (single != null && single in ClipPcmTransformer.SUPPORTED_OUTPUT_RATES) return single
    return if (rates.any { it >= 48_000 }) 48_000 else 44_100
  }

  fun selectOutputChannelCount(formats: List<DecodedSourceFormat>): Int {
    require(formats.isNotEmpty())
    if (formats.any { it.channelCount !in 1..2 }) {
      throw mediaError(SnapCutMediaError.UNSUPPORTED_CHANNEL_COUNT)
    }
    return if (formats.all { it.channelCount == 1 }) 1 else 2
  }

  fun requireMatchingRequest(
    request: ExportAudioRequest,
    formats: List<DecodedSourceFormat>
  ): DecodedOutputConfig {
    if (
      request.jobId.isBlank() ||
      request.projectId.isBlank() ||
      request.displayNameWithoutExtension.isBlank() ||
      request.generation < 0L ||
      request.format !in setOf(ExportFormat.M4A, ExportFormat.MP3) ||
      request.m4aPlan != null
    ) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    val expectedRate = selectOutputSampleRate(formats)
    val expectedChannels = selectOutputChannelCount(formats)
    if (
      request.outputSampleRateHz != expectedRate ||
      request.outputChannelCount != expectedChannels
    ) {
      throw mediaError(SnapCutMediaError.EXPORT_PREFLIGHT_FAILED)
    }
    return DecodedOutputConfig(expectedRate, expectedChannels)
  }
}

internal data class DecodedOutputConfig(
  val sampleRateHz: Int,
  val channelCount: Int
)
