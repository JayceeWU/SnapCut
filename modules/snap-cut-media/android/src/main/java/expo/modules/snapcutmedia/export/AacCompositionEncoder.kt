package expo.modules.snapcutmedia.export

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.ExportFormat
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/**
 * Streaming AAC-LC encoder used when a composition needs silence, mixing, gain, or fades.
 * PCM is never materialized as a full temporary file; each bounded mixer chunk is queued
 * directly into MediaCodec and muxed into the private staging M4A.
 */
internal class AacCompositionEncoder(
  config: CompositionEncoderConfig
) : CompositionEncoder {
  private val validated = config.also {
    require(it.format == ExportFormat.M4A)
    require(it.sampleRateHz in ClipPcmTransformer.SUPPORTED_OUTPUT_RATES)
    require(it.channelCount in 1..2)
    require(it.totalFrames > 0L)
  }
  private val hooks = validated.hooks
  private val channels = validated.channelCount
  private val closed = AtomicBoolean(false)
  private val finished = AtomicBoolean(false)
  private val format = createFormat(validated.sampleRateHz, channels)
  private val resources = createResources(validated, format)
  private val codec = resources.codec
  private val muxer = resources.muxer
  private val info = MediaCodec.BufferInfo()
  private var muxerTrack = -1
  private var muxerStarted = false
  private var submittedFrames = 0L

  init {
    try {
      hooks.attach(this)
    } catch (error: Throwable) {
      // NativeJobRegistry can reject an attachment when cancellation wins the
      // constructor race. The object will never reach a caller-owned `use`
      // block in that case, so release the already-started codec and muxer here.
      closed.set(true)
      runCatching { codec.stop() }
      runCatching { codec.release() }
      runCatching { muxer.release() }
      throw error
    }
  }

  override fun write(interleaved: FloatArray, frameCount: Int) {
    if (closed.get() || finished.get()) throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED)
    require(frameCount in 1..ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES)
    require(interleaved.size == frameCount * channels)
    var sourceFrame = 0
    while (sourceFrame < frameCount) {
      val inputIndex = awaitInputBuffer()
      val input = codec.getInputBuffer(inputIndex)
        ?: throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED, "input-buffer")
      input.clear()
      input.order(ByteOrder.LITTLE_ENDIAN)
      val writableFrames = minOf(
        frameCount - sourceFrame,
        input.remaining() / (Short.SIZE_BYTES * channels)
      )
      if (writableFrames <= 0) throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED, "capacity")
      val firstSample = sourceFrame * channels
      val sampleCount = writableFrames * channels
      for (sampleIndex in firstSample until firstSample + sampleCount) {
        val sample = interleaved[sampleIndex]
          .takeIf(Float::isFinite)
          ?.coerceIn(-1f, 1f)
          ?: 0f
        input.putShort((sample * Short.MAX_VALUE).roundToInt().toShort())
      }
      codec.queueInputBuffer(
        inputIndex,
        0,
        writableFrames * channels * Short.SIZE_BYTES,
        presentationTimeUs(submittedFrames),
        0
      )
      submittedFrames += writableFrames
      sourceFrame += writableFrames
      drain(endOfStream = false)
    }
  }

  override fun finish() {
    if (!finished.compareAndSet(false, true)) return
    if (closed.get()) throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
    val inputIndex = awaitInputBuffer()
    codec.queueInputBuffer(
      inputIndex,
      0,
      0,
      presentationTimeUs(submittedFrames),
      MediaCodec.BUFFER_FLAG_END_OF_STREAM
    )
    drain(endOfStream = true)
    if (!muxerStarted || muxerTrack < 0) {
      throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED, "missing-output-format")
    }
  }

  override fun close() = cancel()

  override fun cancel() {
    if (!closed.compareAndSet(false, true)) return
    hooks.detach(this)
    runCatching { codec.stop() }
    runCatching { codec.release() }
    if (muxerStarted) runCatching { muxer.stop() }
    runCatching { muxer.release() }
  }

  private fun awaitInputBuffer(): Int {
    val deadline = EncoderProgressDeadline(NO_PROGRESS_TIMEOUT_NS)
    while (!closed.get()) {
      val index = codec.dequeueInputBuffer(CODEC_TIMEOUT_US)
      if (index >= 0) return index
      if (drain(endOfStream = false)) deadline.markProgress()
      if (deadline.hasExpired()) {
        throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED, "input-timeout")
      }
    }
    throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
  }

  private fun drain(endOfStream: Boolean): Boolean {
    var madeProgress = false
    val deadline = EncoderProgressDeadline(NO_PROGRESS_TIMEOUT_NS)
    while (!closed.get()) {
      val index = codec.dequeueOutputBuffer(
        info,
        if (endOfStream) CODEC_TIMEOUT_US else 0L
      )
      when {
        index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          if (!endOfStream) return madeProgress
          if (deadline.hasExpired()) {
            throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED, "eos-timeout")
          }
        }
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          if (muxerStarted) throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED, "format-repeat")
          muxerTrack = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxerStarted = true
          madeProgress = true
          deadline.markProgress()
        }
        index >= 0 -> {
          val output = codec.getOutputBuffer(index)
            ?: throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED, "output-buffer")
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
          if (info.size > 0) {
            if (!muxerStarted) {
              throw mediaError(SnapCutMediaError.AAC_ENCODER_FAILED, "format-missing")
            }
            output.position(info.offset)
            output.limit(info.offset + info.size)
            muxer.writeSampleData(muxerTrack, output, info)
          }
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          codec.releaseOutputBuffer(index, false)
          madeProgress = true
          deadline.markProgress()
          if (eos) return true
        }
      }
    }
    throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
  }

  private fun presentationTimeUs(frame: Long): Long =
    Math.multiplyExact(frame, 1_000_000L) / validated.sampleRateHz

  internal companion object {
    const val STEREO_BITRATE_BPS = 320_000
    const val MONO_BITRATE_BPS = 160_000
    private const val CODEC_TIMEOUT_US = 10_000L
    private const val NO_PROGRESS_TIMEOUT_NS = 10_000_000_000L

    fun isAvailable(sampleRateHz: Int, channelCount: Int): Boolean = runCatching {
      MediaCodecList(MediaCodecList.REGULAR_CODECS)
        .findEncoderForFormat(createFormat(sampleRateHz, channelCount)) != null
    }.getOrDefault(false)

    private data class EncoderResources(val codec: MediaCodec, val muxer: MediaMuxer)

    private fun createResources(
      config: CompositionEncoderConfig,
      format: MediaFormat
    ): EncoderResources {
      var codec: MediaCodec? = null
      var muxer: MediaMuxer? = null
      try {
        val encoderName = MediaCodecList(MediaCodecList.REGULAR_CODECS)
          .findEncoderForFormat(format)
          ?: throw mediaError(SnapCutMediaError.AAC_ENCODER_INIT_FAILED, "encoder-unavailable")
        codec = MediaCodec.createByCodecName(encoderName)
        muxer = MediaMuxer(
          config.outputFile.absolutePath,
          MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
        )
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        return EncoderResources(codec, muxer)
      } catch (error: Exception) {
        runCatching { codec?.stop() }
        runCatching { codec?.release() }
        runCatching { muxer?.release() }
        throw if (error is expo.modules.snapcutmedia.errors.SnapCutMediaException) error
        else mediaError(SnapCutMediaError.AAC_ENCODER_INIT_FAILED, cause = error)
      }
    }

    private fun createFormat(sampleRateHz: Int, channelCount: Int): MediaFormat =
      MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRateHz, channelCount)
        .apply {
          setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
          setInteger(
            MediaFormat.KEY_BIT_RATE,
            if (channelCount == 1) MONO_BITRATE_BPS else STEREO_BITRATE_BPS
          )
          setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
          setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES * channelCount * 2)
        }
  }
}

internal class EncoderProgressDeadline(
  private val timeoutNs: Long,
  private val nowNs: () -> Long = System::nanoTime
) {
  private var lastProgressNs = nowNs()

  init {
    require(timeoutNs > 0L)
  }

  fun markProgress() {
    lastProgressNs = nowNs()
  }

  fun hasExpired(): Boolean = nowNs() - lastProgressNs >= timeoutNs
}
