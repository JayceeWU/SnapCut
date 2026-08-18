package expo.modules.snapcutmedia.export

import android.media.MediaCodecList
import android.media.MediaCodecInfo
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
      ExportFormat.MP3 -> SnapCutMediaError.MP3_VERIFICATION_FAILED
      ExportFormat.M4A -> SnapCutMediaError.AAC_VERIFICATION_FAILED
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
        val acceptedMime = when (format) {
          ExportFormat.MP3 -> mime == "audio/mpeg"
          ExportFormat.M4A -> mime == MediaFormat.MIMETYPE_AUDIO_AAC
        }
        val sampleRate = trackFormat.integerOrNull(MediaFormat.KEY_SAMPLE_RATE)
        val channels = trackFormat.integerOrNull(MediaFormat.KEY_CHANNEL_COUNT)
        val durationUs = trackFormat.longOrNull(MediaFormat.KEY_DURATION)
        if (!acceptedMime) fail("mime:$mime")
        if (format == ExportFormat.M4A && !isAacLc(trackFormat)) fail("aac-profile")
        if (sampleRate != expectedSampleRateHz) fail("sample-rate")
        if (channels != expectedChannelCount) fail("channel-count")
        if (durationUs == null || durationUs <= 0L) fail("duration-missing")
        if (
          MediaCodecList(MediaCodecList.REGULAR_CODECS)
            .findDecoderForFormat(trackFormat) == null
        ) fail("decoder")
        val expectedDurationUs = framesToDurationUs(expectedFrames, expectedSampleRateHz)
        val toleranceUs = when (format) {
          // LAME adds encoder delay and pads to complete MPEG audio frames.
          ExportFormat.MP3 -> MP3_FIXED_TOLERANCE_US +
            framesToDurationUs(MP3_DELAY_PADDING_FRAMES, expectedSampleRateHz)
          // AAC-LC encoders commonly add codec delay and pad to complete access units.
          ExportFormat.M4A -> AAC_FIXED_TOLERANCE_US +
            framesToDurationUs(AAC_DELAY_PADDING_FRAMES, expectedSampleRateHz)
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
          codecMime = mime,
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

  private fun isAacLc(format: MediaFormat): Boolean {
    val declared = format.integerOrNull(MediaFormat.KEY_AAC_PROFILE)
      ?: format.integerOrNull(MediaFormat.KEY_PROFILE)
    if (declared != null) return declared == MediaCodecInfo.CodecProfileLevel.AACObjectLC
    val config = format.byteBufferOrNull("csd-0") ?: return false
    if (!config.hasRemaining()) return false
    val first = config.get(config.position()).toInt() and 0xff
    val audioObjectType = first ushr 3
    return audioObjectType == MediaCodecInfo.CodecProfileLevel.AACObjectLC
  }

  private companion object {
    const val MP3_FIXED_TOLERANCE_US = 50_000L
    const val MP3_DELAY_PADDING_FRAMES = 2_304L
    const val AAC_FIXED_TOLERANCE_US = 50_000L
    const val AAC_DELAY_PADDING_FRAMES = 2_048L
  }
}

private fun MediaFormat.byteBufferOrNull(key: String) =
  if (containsKey(key)) runCatching { getByteBuffer(key)?.duplicate() }.getOrNull() else null
