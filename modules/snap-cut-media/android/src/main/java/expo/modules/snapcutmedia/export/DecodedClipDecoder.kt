package expo.modules.snapcutmedia.export

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.exportmedia.ExportExtractorResource
import expo.modules.snapcutmedia.exportmedia.ResolvedExportClip
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import java.io.Closeable
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

internal data class DecodedSourceDescriptor(
  val audioTrackIndex: Int,
  val codecMime: String,
  val sampleRateHz: Int,
  val channelCount: Int,
  val durationUs: Long,
  val decoderName: String
) {
  val outputFormat: DecodedSourceFormat
    get() = DecodedSourceFormat(sampleRateHz, channelCount)
}

internal class DecodedSourceProbe {
  fun probe(
    file: File,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): DecodedSourceDescriptor {
    cancellation.throwIfCancelled()
    val resource = ExportExtractorResource(MediaExtractor(), hooks)
    try {
      resource.extractor.setDataSource(file.absolutePath)
      val extractor = resource.extractor
      val audioTracks = (0 until extractor.trackCount).mapNotNull { index ->
        val format = extractor.getTrackFormat(index)
        val mime = format.stringOrNull(MediaFormat.KEY_MIME)
        if (mime?.startsWith("audio/") == true) Triple(index, format, mime) else null
      }
      if (audioTracks.isEmpty()) throw mediaError(SnapCutMediaError.NO_AUDIO_TRACK)
      val (index, format, mime) = audioTracks.first()
      val sampleRate = format.integerOrNull(MediaFormat.KEY_SAMPLE_RATE)
        ?.takeIf { it in MIN_SOURCE_RATE..MAX_SOURCE_RATE }
        ?: throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      val channels = format.integerOrNull(MediaFormat.KEY_CHANNEL_COUNT)
        ?: throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      if (channels !in 1..2) throw mediaError(SnapCutMediaError.UNSUPPORTED_CHANNEL_COUNT)
      val duration = format.longOrNull(MediaFormat.KEY_DURATION)
        ?.takeIf { it > 0L }
        ?: throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      val decoder = runCatching {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(format)
      }.getOrNull() ?: throw mediaError(SnapCutMediaError.UNSUPPORTED_AUDIO_CODEC)
      return DecodedSourceDescriptor(index, mime, sampleRate, channels, duration, decoder)
    } catch (error: Exception) {
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    } finally {
      resource.close()
    }
  }

  private companion object {
    const val MIN_SOURCE_RATE = 8_000
    const val MAX_SOURCE_RATE = 384_000
  }
}

internal data class DecodedClipStats(
  val selectedSourceFrames: Long,
  val sampleRateHz: Int,
  val channelCount: Int
)

internal class DecodedClipDecoder {
  fun decode(
    clip: ResolvedExportClip,
    descriptor: DecodedSourceDescriptor,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    onFormat: (DecodedSourceFormat) -> Unit,
    onPcm: (FloatArray, Int) -> Unit,
    onProgress: (Double) -> Unit = {}
  ): DecodedClipStats {
    val startUs = multiplyMs(clip.startMs)
    val endUs = multiplyMs(clip.endMs)
    if (endUs > descriptor.durationUs + END_METADATA_TOLERANCE_US) {
      throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
    }
    val requestedRange = ClipTimeRange(clip.startMs, clip.endMs)
    val extractorResource = ExportExtractorResource(MediaExtractor(), hooks)
    try {
      extractorResource.extractor.setDataSource(clip.file.absolutePath)
      val extractor = extractorResource.extractor
      if (descriptor.audioTrackIndex !in 0 until extractor.trackCount) {
        throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      }
      val inputFormat = extractor.getTrackFormat(descriptor.audioTrackIndex)
      val mime = inputFormat.stringOrNull(MediaFormat.KEY_MIME)
      if (mime != descriptor.codecMime) {
        throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      }
      extractor.selectTrack(descriptor.audioTrackIndex)
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

      val codec = try {
        MediaCodec.createByCodecName(descriptor.decoderName)
      } catch (_: Exception) {
        throw mediaError(SnapCutMediaError.UNSUPPORTED_AUDIO_CODEC)
      }
      val codecResource = DecodedCodecResource(codec, hooks)
      try {
        codec.configure(inputFormat, null, null, 0)
        codec.start()
        codecResource.markStarted()
        return decodeLoop(
          extractor,
          codec,
          descriptor,
          startUs,
          endUs,
          requestedRange,
          cancellation,
          onFormat,
          onPcm,
          onProgress
        )
      } finally {
        codecResource.close()
      }
    } catch (error: Exception) {
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    } finally {
      extractorResource.close()
    }
  }

  private fun decodeLoop(
    extractor: MediaExtractor,
    codec: MediaCodec,
    descriptor: DecodedSourceDescriptor,
    startUs: Long,
    endUs: Long,
    requestedRange: ClipTimeRange,
    cancellation: CancellationCheck,
    onFormat: (DecodedSourceFormat) -> Unit,
    onPcm: (FloatArray, Int) -> Unit,
    onProgress: (Double) -> Unit
  ): DecodedClipStats {
    var inputEnded = false
    var outputEnded = false
    var outputFormat: OutputPcmFormat? = null
    var selectedFrames = 0L
    val info = MediaCodec.BufferInfo()

    while (!outputEnded) {
      cancellation.throwIfCancelled()
      if (!inputEnded) {
        val inputIndex = codec.dequeueInputBuffer(CODEC_TIMEOUT_US)
        if (inputIndex >= 0) {
          val sampleTime = extractor.sampleTime
          if (sampleTime < 0L || sampleTime >= endUs) {
            codec.queueInputBuffer(
              inputIndex,
              0,
              0,
              endUs,
              MediaCodec.BUFFER_FLAG_END_OF_STREAM
            )
            inputEnded = true
          } else {
            val sampleSize = extractor.sampleSize
            if (sampleSize <= 0L || sampleSize > MAX_ENCODED_SAMPLE_BYTES) {
              throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
            }
            val input = codec.getInputBuffer(inputIndex)
              ?: throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
            if (sampleSize > input.capacity()) {
              throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
            }
            input.clear()
            val bytesRead = extractor.readSampleData(input, 0)
            if (bytesRead <= 0 || bytesRead.toLong() != sampleSize) {
              throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
            }
            codec.queueInputBuffer(
              inputIndex,
              0,
              bytesRead,
              sampleTime,
              extractor.sampleFlags
            )
            extractor.advance()
          }
        }
      }

      when (val outputIndex = codec.dequeueOutputBuffer(info, CODEC_TIMEOUT_US)) {
        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          outputFormat = requireStableOutputFormat(
            previous = outputFormat,
            next = codec.outputFormat.toOutputPcmFormat(descriptor),
            onFormat = onFormat
          )
        }
        MediaCodec.INFO_TRY_AGAIN_LATER,
        MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit
        else -> if (outputIndex >= 0) {
          try {
            if (
              info.size > 0 &&
              info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0
            ) {
              val pcmFormat = outputFormat ?: requireStableOutputFormat(
                previous = null,
                next = codec.outputFormat.toOutputPcmFormat(descriptor),
                onFormat = onFormat
              ).also { outputFormat = it }
              val output = codec.getOutputBuffer(outputIndex)
                ?: throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
              val endOffset = Math.addExact(info.offset, info.size)
              if (info.offset < 0 || endOffset > output.capacity()) {
                throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
              }
              val view = output.duplicate().apply {
                position(info.offset)
                limit(endOffset)
              }
              val decoded = try {
                DecodedPcm.readInterleaved(view, pcmFormat.channels, pcmFormat.encoding)
              } catch (_: IllegalArgumentException) {
                throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
              }
              val bufferFrames = decoded.size / pcmFormat.channels
              val slice = ClipFrameMath.slice(
                maxOf(0L, info.presentationTimeUs),
                bufferFrames,
                pcmFormat.sampleRateHz,
                requestedRange.startMs,
                requestedRange.endMs
              )
              if (slice.frameCount > 0) {
                val selected = DecodedPcm.sliceFrames(decoded, pcmFormat.channels, slice)
                emitBounded(selected, pcmFormat.channels, onPcm)
                selectedFrames = Math.addExact(selectedFrames, slice.frameCount.toLong())
              }
              val progressUs = (info.presentationTimeUs - startUs).coerceAtLeast(0L)
              onProgress(
                (progressUs.toDouble() / (endUs - startUs).toDouble()).coerceIn(0.0, 1.0)
              )
            }
            outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          } finally {
            codec.releaseOutputBuffer(outputIndex, false)
          }
        }
      }
    }
    val finalFormat = outputFormat ?: throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    if (selectedFrames <= 0L) throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    onProgress(1.0)
    return DecodedClipStats(selectedFrames, finalFormat.sampleRateHz, finalFormat.channels)
  }

  private fun requireStableOutputFormat(
    previous: OutputPcmFormat?,
    next: OutputPcmFormat,
    onFormat: (DecodedSourceFormat) -> Unit
  ): OutputPcmFormat {
    if (previous != null && previous != next) {
      throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    }
    if (previous == null) onFormat(DecodedSourceFormat(next.sampleRateHz, next.channels))
    return next
  }

  private fun emitBounded(
    interleaved: FloatArray,
    channels: Int,
    sink: (FloatArray, Int) -> Unit
  ) {
    var firstFrame = 0
    val frames = interleaved.size / channels
    while (firstFrame < frames) {
      val count = minOf(ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES, frames - firstFrame)
      val firstSample = firstFrame * channels
      sink(
        interleaved.copyOfRange(firstSample, firstSample + count * channels),
        count
      )
      firstFrame += count
    }
  }

  private fun multiplyMs(value: Long): Long = try {
    Math.multiplyExact(value, 1_000L)
  } catch (_: ArithmeticException) {
    throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
  }

  private data class OutputPcmFormat(
    val sampleRateHz: Int,
    val channels: Int,
    val encoding: PcmSampleEncoding
  )

  private data class ClipTimeRange(val startMs: Long, val endMs: Long)

  private fun MediaFormat.toOutputPcmFormat(
    expected: DecodedSourceDescriptor
  ): OutputPcmFormat {
    val rate = integerOrNull(MediaFormat.KEY_SAMPLE_RATE) ?: expected.sampleRateHz
    val channels = integerOrNull(MediaFormat.KEY_CHANNEL_COUNT) ?: expected.channelCount
    if (rate != expected.sampleRateHz) {
      throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    }
    if (channels !in 1..2) throw mediaError(SnapCutMediaError.UNSUPPORTED_CHANNEL_COUNT)
    if (channels != expected.channelCount) {
      throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    }
    val encoding = when (
      integerOrNull(MediaFormat.KEY_PCM_ENCODING) ?: AudioFormat.ENCODING_PCM_16BIT
    ) {
      AudioFormat.ENCODING_PCM_8BIT -> PcmSampleEncoding.UNSIGNED_8
      AudioFormat.ENCODING_PCM_16BIT -> PcmSampleEncoding.SIGNED_16
      AudioFormat.ENCODING_PCM_24BIT_PACKED -> PcmSampleEncoding.SIGNED_24_PACKED
      AudioFormat.ENCODING_PCM_32BIT -> PcmSampleEncoding.SIGNED_32
      AudioFormat.ENCODING_PCM_FLOAT -> PcmSampleEncoding.FLOAT_32
      else -> throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    }
    return OutputPcmFormat(rate, channels, encoding)
  }

  private class DecodedCodecResource(
    private val codec: MediaCodec,
    private val hooks: MediaResourceHooks
  ) : Closeable, NativeJobResource {
    private val closed = AtomicBoolean(false)
    private val started = AtomicBoolean(false)

    init {
      hooks.attach(this)
    }

    fun markStarted() {
      started.set(true)
    }

    override fun close() = cancel()

    override fun cancel() {
      if (!closed.compareAndSet(false, true)) return
      hooks.detach(this)
      if (started.get()) runCatching(codec::stop)
      runCatching(codec::release)
    }
  }

  private companion object {
    const val CODEC_TIMEOUT_US = 10_000L
    const val END_METADATA_TOLERANCE_US = 1_000L
    const val MAX_ENCODED_SAMPLE_BYTES = 8L * 1024L * 1024L
  }
}

internal fun MediaFormat.integerOrNull(key: String): Int? =
  if (containsKey(key)) runCatching { getInteger(key) }.getOrNull() else null

internal fun MediaFormat.longOrNull(key: String): Long? =
  if (containsKey(key)) runCatching { getLong(key) }.getOrNull() else null

internal fun MediaFormat.stringOrNull(key: String): String? =
  if (containsKey(key)) runCatching { getString(key) }.getOrNull() else null
