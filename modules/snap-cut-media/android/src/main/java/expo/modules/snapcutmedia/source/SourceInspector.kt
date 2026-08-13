package expo.modules.snapcutmedia.source

import android.content.ContentResolver
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

internal class SourceInspector(
  private val resolver: ContentResolver,
  private val spoolRoot: File,
  private val decoderAvailability: DecoderAvailability = PlatformDecoderAvailability
) {
  fun inspect(
    sourceUri: String,
    maxSourceBytes: Long,
    cancellation: CancellationCheck = CancellationCheck.NONE,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE
  ): SourceInspection = openSession(sourceUri, maxSourceBytes, cancellation, hooks).use { session ->
    inspectSession(session, cancellation).inspection
  }

  fun openSession(
    sourceUri: String,
    maxSourceBytes: Long,
    cancellation: CancellationCheck = CancellationCheck.NONE,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE
  ): SourceSession = SourceSession.open(
    resolver,
    sourceUri,
    maxSourceBytes,
    spoolRoot,
    cancellation,
    hooks
  )

  fun inspectSession(
    session: SourceSession,
    cancellation: CancellationCheck = CancellationCheck.NONE
  ): InspectedSource {
    cancellation.throwIfCancelled()
    try {
      session.openExtractor().use { managed ->
        val extractor = managed.extractor
        val (candidates, hasVideo) = AudioTrackPolicy.collect(
          extractor,
          session.containerProbe,
          decoderAvailability
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
