package expo.modules.snapcutmedia.waveform

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaFormat
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.models.GenerateWaveformRequest
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.source.SourceInspector
import expo.modules.snapcutmedia.source.SourceSizePolicy
import expo.modules.snapcutmedia.storage.PrivateOutputUri
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.atomic.AtomicBoolean

internal class WaveformService(
  private val inspector: SourceInspector,
  private val projectRoots: Collection<File>
) {
  fun generate(
    request: GenerateWaveformRequest,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE,
    progressSink: (WaveformProgress) -> Unit = {}
  ) {
    if (
      request.jobId.isBlank() ||
      request.sourceId.isBlank() ||
      request.generation < 0L ||
      request.binCount != REQUIRED_BIN_COUNT
    ) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    val input = PrivateOutputUri.requireSafeFileUri(request.audioFileUri, projectRoots)
    val output = PrivateOutputUri.requireSafeFileUri(request.outputWaveformFileUri, projectRoots)
    if (!input.isFile || input.length() <= 0L) {
      throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE)
    }
    if (input.path == output.path) {
      throw mediaError(SnapCutMediaError.OUTPUT_ALIASES_SOURCE)
    }
    val partial = File(output.path + PARTIAL_SUFFIX)
    if (!output.parentFile.exists() && !output.parentFile.mkdirs()) {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
    }
    val reporter = WaveformProgressReporter(progressSink)
    try {
      cancellation.throwIfCancelled()
      if (partial.exists() && !partial.delete()) {
        throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
      }
      reporter.report("processing", 0.0, force = true)
      val data = decode(
        input.toURI().toString(),
        request.binCount,
        cancellation,
        hooks,
        reporter
      )
      cancellation.throwIfCancelled()
      reporter.report("writing", null, force = true)
      val json = WaveformJson.encode(data)
      writeAndVerify(partial, json, hooks)
      cancellation.throwIfCancelled()
      commitPartial(partial, output)
      if (partial.exists() || !output.isFile || output.readText(Charsets.UTF_8) != json) {
        throw mediaError(SnapCutMediaError.WAVEFORM_DECODE_FAILED)
      }
      reporter.report("complete", 1.0, force = true)
    } catch (error: Exception) {
      runCatching { if (partial.exists()) partial.delete() }
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.WAVEFORM_DECODE_FAILED, cause = error)
    }
  }

  private fun decode(
    sourceUri: String,
    binCount: Int,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    reporter: WaveformProgressReporter
  ): WaveformData {
    inspector.openSession(
      sourceUri,
      SourceSizePolicy.MAX_SOURCE_BYTES,
      cancellation,
      hooks
    ).use { session ->
      val inspected = inspector.inspectSession(session, cancellation)
      val inspection = inspected.inspection
      val accumulator = WaveformAccumulator(
        inspection.durationMs,
        inspection.sampleRateHz,
        binCount
      )
      session.openExtractor().use { managed ->
        val extractor = managed.extractor
        extractor.selectTrack(inspected.selectedTrackIndex)
        val inputFormat = extractor.getTrackFormat(inspected.selectedTrackIndex)
        val codec = try {
          MediaCodec.createDecoderByType(inspection.codecMime)
        } catch (error: Exception) {
          throw mediaError(SnapCutMediaError.WAVEFORM_DECODE_FAILED, cause = error)
        }
        val codecResource = CodecResource(codec, hooks)
        try {
          codec.configure(inputFormat, null, null, 0)
          codec.start()
          codecResource.markStarted()
          decodeLoop(
            extractor,
            codec,
            inspection.channelCount,
            accumulator,
            cancellation,
            reporter
          )
        } finally {
          codecResource.close()
        }
      }
      if (!accumulator.hasFrames()) {
        throw mediaError(SnapCutMediaError.WAVEFORM_DECODE_FAILED)
      }
      return accumulator.finish()
    }
  }

  private fun decodeLoop(
    extractor: android.media.MediaExtractor,
    codec: MediaCodec,
    initialChannelCount: Int,
    accumulator: WaveformAccumulator,
    cancellation: CancellationCheck,
    reporter: WaveformProgressReporter
  ) {
    var inputEnded = false
    var outputEnded = false
    var channelCount = initialChannelCount
    var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
    val info = MediaCodec.BufferInfo()
    while (!outputEnded) {
      cancellation.throwIfCancelled()
      if (!inputEnded) {
        val inputIndex = codec.dequeueInputBuffer(CODEC_TIMEOUT_US)
        if (inputIndex >= 0) {
          val buffer = codec.getInputBuffer(inputIndex)
            ?: throw mediaError(SnapCutMediaError.WAVEFORM_DECODE_FAILED)
          buffer.clear()
          val bytes = extractor.readSampleData(buffer, 0)
          if (bytes < 0) {
            codec.queueInputBuffer(
              inputIndex,
              0,
              0,
              0L,
              MediaCodec.BUFFER_FLAG_END_OF_STREAM
            )
            inputEnded = true
          } else {
            codec.queueInputBuffer(
              inputIndex,
              0,
              bytes,
              maxOf(0L, extractor.sampleTime),
              extractor.sampleFlags
            )
            extractor.advance()
          }
        }
      }

      when (val outputIndex = codec.dequeueOutputBuffer(info, CODEC_TIMEOUT_US)) {
        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          val format = codec.outputFormat
          channelCount = format.integerOrNull(MediaFormat.KEY_CHANNEL_COUNT) ?: channelCount
          pcmEncoding = format.integerOrNull(MediaFormat.KEY_PCM_ENCODING)
            ?: AudioFormat.ENCODING_PCM_16BIT
          if (channelCount !in 1..2) {
            throw mediaError(SnapCutMediaError.UNSUPPORTED_CHANNEL_COUNT)
          }
        }
        MediaCodec.INFO_TRY_AGAIN_LATER,
        MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> Unit
        else -> if (outputIndex >= 0) {
          val buffer = codec.getOutputBuffer(outputIndex)
          if (
            buffer != null &&
            info.size > 0 &&
            info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0
          ) {
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            try {
              PcmFrameReader.consume(buffer, channelCount, pcmEncoding, accumulator::addFrame)
            } catch (error: IllegalArgumentException) {
              throw mediaError(SnapCutMediaError.WAVEFORM_DECODE_FAILED, cause = error)
            }
            reporter.report("processing", accumulator.fraction())
          }
          outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          codec.releaseOutputBuffer(outputIndex, false)
        }
      }
    }
  }

  private fun writeAndVerify(file: File, json: String, hooks: MediaResourceHooks) {
    FileOutputStream(file).use { output ->
      val resource = OutputResource(output, hooks)
      try {
        output.write(json.toByteArray(Charsets.UTF_8))
        output.fd.sync()
      } finally {
        resource.close()
      }
    }
    if (!file.isFile || file.readText(Charsets.UTF_8) != json) {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
    }
  }

  private fun commitPartial(partial: File, output: File) {
    try {
      Files.move(
        partial.toPath(),
        output.toPath(),
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING
      )
    } catch (_: AtomicMoveNotSupportedException) {
      Files.move(partial.toPath(), output.toPath(), StandardCopyOption.REPLACE_EXISTING)
    } catch (error: Exception) {
      if (!output.isFile) throw error
    }
  }

  private fun MediaFormat.integerOrNull(key: String): Int? =
    if (containsKey(key)) runCatching { getInteger(key) }.getOrNull() else null

  private class CodecResource(
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

  private class OutputResource(
    private val output: FileOutputStream,
    private val hooks: MediaResourceHooks
  ) : Closeable, NativeJobResource {
    private val closed = AtomicBoolean(false)

    init {
      hooks.attach(this)
    }

    override fun close() = cancel()

    override fun cancel() {
      if (!closed.compareAndSet(false, true)) return
      hooks.detach(this)
      runCatching(output::close)
    }
  }

  private companion object {
    const val REQUIRED_BIN_COUNT = 8192
    const val PARTIAL_SUFFIX = ".partial"
    const val CODEC_TIMEOUT_US = 10_000L
  }
}
