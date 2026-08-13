package expo.modules.snapcutmedia.exportmedia

import android.media.MediaExtractor
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import java.io.File
import kotlin.math.abs
import kotlin.math.roundToLong

internal data class VerifiedM4aOutput(
  val durationUs: Long,
  val fileSizeBytes: Long,
  val payloadProof: EncodedStreamProof
)

private data class ScannedM4aOutput(
  val payloadProof: EncodedStreamProof,
  val timeline: VerifiedM4aTimeline
)

internal class M4aOutputVerifier(
  private val scanner: M4aSourceScanner
) {
  fun verify(
    file: File,
    expectedFingerprint: String,
    expectedSampleRateHz: Int,
    expectedChannelCount: Int,
    expectedDurationUs: Long,
    expectedPayloadProof: EncodedStreamProof,
    expectedTimelineProof: M4aTimelineProof,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): VerifiedM4aOutput {
    try {
      if (!file.isFile || file.length() <= 0L) {
        throw mediaError(SnapCutMediaError.M4A_VERIFICATION_FAILED)
      }
      if (expectedPayloadProof.sampleCount != expectedTimelineProof.sampleCount) {
        throw mediaError(SnapCutMediaError.M4A_VERIFICATION_FAILED)
      }
      val scanned = M4aTimelineProofReader(
        expectedTimelineProof,
        expectedSampleRateHz
      ).use { timelineReader ->
        scanner.openExtractor(file, hooks).use { resource ->
          val extractor = resource.extractor
          val metadata = scanner.requireM4aTrack(extractor)
          if (
            metadata.codecConfigFingerprint != expectedFingerprint ||
            metadata.sampleRateHz != expectedSampleRateHz ||
            metadata.channelCount != expectedChannelCount
          ) {
            throw mediaError(SnapCutMediaError.M4A_VERIFICATION_FAILED)
          }
          scanner.requireValidTimeline(extractor, metadata, cancellation)
          scanner.resetExtractor(extractor, metadata)
          scanProof(extractor, cancellation, timelineReader)
        }
      }
      val frameDurationUs = (1024.0 * 1_000_000.0 / expectedSampleRateHz).roundToLong()
      val actualDurationUs = Math.addExact(
        scanned.timeline.lastPresentationTimeUs,
        frameDurationUs
      )
      val durationToleranceUs = maxOf(
        DURATION_TOLERANCE_US,
        M4aTimelinePolicy.timebaseToleranceUs(expectedSampleRateHz)
      )
      if (
        scanned.payloadProof != expectedPayloadProof ||
        abs(actualDurationUs - expectedDurationUs) > durationToleranceUs
      ) {
        throw mediaError(SnapCutMediaError.M4A_VERIFICATION_FAILED)
      }
      return VerifiedM4aOutput(actualDurationUs, file.length(), scanned.payloadProof)
    } catch (error: Exception) {
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.M4A_VERIFICATION_FAILED, cause = error)
    }
  }

  private fun scanProof(
    extractor: MediaExtractor,
    cancellation: CancellationCheck,
    timelineReader: M4aTimelineProofReader
  ): ScannedM4aOutput {
    val adaptive = AdaptiveEncodedBuffer()
    val proof = EncodedStreamProofAccumulator()
    while (true) {
      cancellation.throwIfCancelled()
      val timestampUs = extractor.sampleTime
      val sampleSize = extractor.sampleSize
      if (timestampUs < 0L || sampleSize < 0L) break
      val buffer = try {
        adaptive.requireCapacity(sampleSize)
      } catch (error: IllegalArgumentException) {
        throw mediaError(SnapCutMediaError.M4A_VERIFICATION_FAILED, cause = error)
      }
      val bytesRead = extractor.readSampleData(buffer, 0)
      if (bytesRead <= 0 || bytesRead.toLong() != sampleSize) {
        throw mediaError(SnapCutMediaError.M4A_VERIFICATION_FAILED)
      }
      timelineReader.add(timestampUs)
      proof.add(extractor.sampleFlags, buffer, bytesRead)
      if (!extractor.advance()) break
    }
    return ScannedM4aOutput(proof.finish(), timelineReader.finish())
  }

  private companion object {
    const val DURATION_TOLERANCE_US = 2_000L
  }
}
