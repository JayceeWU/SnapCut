package expo.modules.snapcutmedia.source

import android.content.ContentResolver
import android.content.Context
import android.media.MediaExtractor
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.SourceInspection
import java.io.File

internal data class InspectedSource(
  val inspection: SourceInspection,
  val selectedTrackIndex: Int
)

internal enum class SourceInspectionStage(val value: String) {
  SIZE_PROBE("size_probe"),
  STREAM_VERIFICATION("stream_verification"),
  CONTAINER_PROBE("container_probe"),
  EXTRACTOR_OPEN("extractor_open"),
  TRACK_SCAN("track_scan"),
  DECODER_CHECK("decoder_check"),
  BRIDGE_RESULT("bridge_result")
}

internal class SourceInspector(
  private val resolver: ContentResolver,
  private val spoolRoot: File,
  private val context: Context? = null,
  private val decoderAvailability: DecoderAvailability = PlatformDecoderAvailability
) {
  fun inspect(
    sourceUri: String,
    maxSourceBytes: Long,
    cancellation: CancellationCheck = CancellationCheck.NONE,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE,
    onStage: (SourceInspectionStage) -> Unit = {}
  ): SourceInspection = openSession(
    sourceUri,
    maxSourceBytes,
    cancellation,
    hooks,
    onStage
  ).use { session ->
    inspectSession(session, cancellation, onStage).inspection
  }

  fun openSession(
    sourceUri: String,
    maxSourceBytes: Long,
    cancellation: CancellationCheck = CancellationCheck.NONE,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE,
    onStage: (SourceInspectionStage) -> Unit = {}
  ): SourceSession = SourceSession.open(
    resolver = resolver,
    sourceUriString = sourceUri,
    maxSourceBytes = maxSourceBytes,
    spoolRoot = spoolRoot,
    cancellation = cancellation,
    hooks = hooks,
    onStage = onStage,
    context = context
  )

  fun inspectSession(
    session: SourceSession,
    cancellation: CancellationCheck = CancellationCheck.NONE,
    onStage: (SourceInspectionStage) -> Unit = {}
  ): InspectedSource {
    cancellation.throwIfCancelled()
    try {
      onStage(SourceInspectionStage.EXTRACTOR_OPEN)
      session.openExtractor().use { managed ->
        val extractor = managed.extractor
        onStage(SourceInspectionStage.TRACK_SCAN)
        val (candidates, hasVideo) = AudioTrackPolicy.collect(
          extractor,
          session.containerProbe,
          decoderAvailability,
          onDecoderCheck = { onStage(SourceInspectionStage.DECODER_CHECK) }
        )
        val selected = AudioTrackPolicy.select(
          candidates,
          hasVideo,
          session.containerProbe,
          extractorHasDrm(extractor)
        )
        val track = selected.candidate
        return InspectedSource(
          inspection = SourceInspection(
            sourceKind = selected.sourceKind,
            codecMime = track.mime,
            durationMs = (track.durationUs + 500L) / 1000L,
            sampleRateHz = track.sampleRateHz,
            channelCount = track.channelCount,
            encodedBitrateBps = track.encodedBitrateBps,
            pcmBitsPerSample = track.pcmBitsPerSample,
            aacProfile = track.aacProfile,
            codecConfigFingerprint = track.codecConfigFingerprint,
            encoderDelayFrames = track.encoderDelayFrames,
            encoderPaddingFrames = track.encoderPaddingFrames,
            fileSizeBytes = session.actualSizeBytes,
            requiresStreamingSizeVerification = session.requiresStreamingSizeVerification,
            drmProtected = false
          ),
          selectedTrackIndex = track.index
        )
      }
    } catch (error: Exception) {
      if (session.containerProbe.isFragmentMissingInitialization) {
        throw mediaError(SnapCutMediaError.M4S_INIT_MISSING)
      }
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
    }
  }

  private fun extractorHasDrm(extractor: MediaExtractor): Boolean = runCatching {
    extractor.psshInfo?.isNotEmpty() == true
  }.getOrDefault(false)
}
