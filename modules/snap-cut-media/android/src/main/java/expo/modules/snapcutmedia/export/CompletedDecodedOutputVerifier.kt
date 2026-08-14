package expo.modules.snapcutmedia.export

import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.exportmedia.ExportExtractorResource
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import java.io.File
import java.io.FileInputStream
import java.math.BigInteger
import kotlin.math.abs

internal data class VerifiedDecodedOutput(
  val actualDurationMs: Long,
  val fileSizeBytes: Long,
  val codecMime: String,
  val sampleRateHz: Int,
  val channelCount: Int
)

internal class CompletedDecodedOutputVerifier {
  fun verify(
    file: File,
    format: ExportFormat,
    expectedFrames: Long,
    expectedSampleRateHz: Int,
    expectedChannelCount: Int,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): VerifiedDecodedOutput {
    val verificationError = when (format) {
      ExportFormat.FLAC -> SnapCutMediaError.FLAC_VERIFICATION_FAILED
      ExportFormat.MP3 -> SnapCutMediaError.MP3_VERIFICATION_FAILED
      ExportFormat.M4A -> throw mediaError(SnapCutMediaError.EXPORT_FORMAT_UNAVAILABLE)
    }
    fun fail(stage: String): Nothing = throw mediaError(verificationError, stage)
    try {
      cancellation.throwIfCancelled()
      if (!file.isFile || file.length() <= 0L || expectedFrames <= 0L) {
        fail("file")
      }
      val resource = ExportExtractorResource(MediaExtractor(), hooks)
      try {
        resource.extractor.setDataSource(file.absolutePath)
        val extractor = resource.extractor
        val audioTracks = (0 until extractor.trackCount).mapNotNull { index ->
          val track = extractor.getTrackFormat(index)
          val mime = track.stringOrNull(MediaFormat.KEY_MIME)
          if (mime?.startsWith("audio/") == true) Triple(index, track, mime) else null
        }
        if (audioTracks.size != 1) fail("track-count")
        val (trackIndex, trackFormat, mime) = audioTracks.single()
        val flacExtractorPcm =
          format == ExportFormat.FLAC && mime == "audio/raw" && hasFlacSignature(file)
        val acceptedMime = when (format) {
          ExportFormat.FLAC ->
            mime == "audio/flac" || mime == "audio/x-flac" || flacExtractorPcm
          ExportFormat.MP3 -> mime == "audio/mpeg"
          ExportFormat.M4A -> false
        }
        val sampleRate = trackFormat.integerOrNull(MediaFormat.KEY_SAMPLE_RATE)
        val channels = trackFormat.integerOrNull(MediaFormat.KEY_CHANNEL_COUNT)
        val durationUs = trackFormat.longOrNull(MediaFormat.KEY_DURATION)
        if (!acceptedMime) fail("mime:$mime")
        if (sampleRate != expectedSampleRateHz) fail("sample-rate")
        if (channels != expectedChannelCount) fail("channel-count")
        if (durationUs == null || durationUs <= 0L) fail("duration-missing")
        if (
          !flacExtractorPcm &&
          MediaCodecList(MediaCodecList.REGULAR_CODECS)
            .findDecoderForFormat(trackFormat) == null
        ) fail("decoder")
        val expectedDurationUs = framesToDurationUs(expectedFrames, expectedSampleRateHz)
        val toleranceUs = when (format) {
          ExportFormat.FLAC -> FLAC_DURATION_TOLERANCE_US
          // LAME adds encoder delay and pads to complete MPEG audio frames.
          ExportFormat.MP3 -> MP3_FIXED_TOLERANCE_US +
            framesToDurationUs(MP3_DELAY_PADDING_FRAMES, expectedSampleRateHz)
          ExportFormat.M4A -> 0L
        }
        if (abs(durationUs - expectedDurationUs) > toleranceUs) {
          fail("duration-mismatch")
        }

        extractor.selectTrack(trackIndex)
        var sampleCount = 0L
        var lastTimestampUs = -1L
        while (true) {
          cancellation.throwIfCancelled()
          val timestamp = extractor.sampleTime
          val size = extractor.sampleSize
          if (timestamp < 0L || size < 0L) break
          if (size == 0L) fail("empty-sample")
          if (timestamp < lastTimestampUs) fail("timestamp-order")
          lastTimestampUs = timestamp
          sampleCount += 1L
          if (!extractor.advance()) break
        }
        if (sampleCount <= 0L || lastTimestampUs < 0L) fail("samples-missing")
        return VerifiedDecodedOutput(
          actualDurationMs = ceilDivide(durationUs, 1_000L),
          fileSizeBytes = file.length(),
          codecMime = if (flacExtractorPcm) "audio/flac" else mime,
          sampleRateHz = sampleRate,
          channelCount = channels
        )
      } finally {
        resource.close()
      }
    } catch (error: Exception) {
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(verificationError)
    }
  }

  private fun framesToDurationUs(frames: Long, sampleRateHz: Int): Long {
    require(frames >= 0L && sampleRateHz > 0)
    return BigInteger.valueOf(frames)
      .multiply(BigInteger.valueOf(1_000_000L))
      .add(BigInteger.valueOf(sampleRateHz.toLong() - 1L))
      .divide(BigInteger.valueOf(sampleRateHz.toLong()))
      .toLong()
  }

  private fun ceilDivide(value: Long, divisor: Long): Long =
    value / divisor + if (value % divisor == 0L) 0L else 1L

  private fun hasFlacSignature(file: File): Boolean =
    FileInputStream(file).use { input ->
      val signature = ByteArray(4)
      input.read(signature) == signature.size && signature.contentEquals(FLAC_SIGNATURE)
    }

  private companion object {
    const val FLAC_DURATION_TOLERANCE_US = 2_000L
    const val MP3_FIXED_TOLERANCE_US = 50_000L
    const val MP3_DELAY_PADDING_FRAMES = 2_304L
    val FLAC_SIGNATURE = byteArrayOf(0x66, 0x4c, 0x61, 0x43)
  }
}
