package expo.modules.snapcutmedia.export

import expo.modules.snapcutmedia.codec.NativeCodecBridge
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.source.MediaResourceHooks
import java.io.Closeable
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal interface CompositionEncoder : FloatPcmSink, Closeable, NativeJobResource {
  fun finish()
}

internal fun interface CompositionEncoderFactory {
  fun create(config: CompositionEncoderConfig): CompositionEncoder
}

internal data class CompositionEncoderConfig(
  val format: ExportFormat,
  val outputFile: File,
  val sampleRateHz: Int,
  val channelCount: Int,
  val totalFrames: Long,
  val title: String,
  val hooks: MediaResourceHooks = MediaResourceHooks.NONE
)

internal class NativeCompositionEncoderFactory : CompositionEncoderFactory {
  override fun create(config: CompositionEncoderConfig): CompositionEncoder =
    if (config.format == ExportFormat.M4A) {
      AacCompositionEncoder(config)
    } else {
      NativeCompositionEncoder(config)
    }
}

internal class NativeStatefulResamplerFactory(
  private val hooks: MediaResourceHooks = MediaResourceHooks.NONE
) : StatefulResamplerFactory {
  override fun create(inputRate: Int, outputRate: Int, channels: Int): StatefulResampler =
    NativeStatefulResampler(inputRate, outputRate, channels, hooks)
}

internal class NativeStatefulResampler(
  private val inputRate: Int,
  private val outputRate: Int,
  private val channels: Int,
  private val hooks: MediaResourceHooks = MediaResourceHooks.NONE
) : StatefulResampler, NativeJobResource {
  init {
    ResamplerCapacityContract.requiredOutputFrames(
      inputFrames = ResamplerCapacityContract.MAX_INPUT_FRAMES,
      inputRateHz = inputRate,
      outputRateHz = outputRate
    )
    require(channels in 1..2)
  }

  private val handle = AtomicLong(
    NativeExportCodecBridge.createResampler(inputRate, outputRate, channels).also {
      if (it <= 0L) throw mediaError(SnapCutMediaError.EXPORT_RESAMPLE_FAILED)
    }
  )

  init {
    hooks.attach(this)
  }

  override fun process(interleaved: FloatArray, frameCount: Int): FloatArray {
    require(frameCount in 0..ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES)
    require(interleaved.size == frameCount * channels)
    if (frameCount == 0) return FloatArray(0)
    return NativeExportCodecBridge.processResampler(requireHandle(), interleaved, frameCount, false)
      ?: throw mediaError(SnapCutMediaError.EXPORT_RESAMPLE_FAILED)
  }

  override fun flush(): FloatArray =
    NativeExportCodecBridge.processResampler(requireHandle(), FloatArray(0), 0, true)
      ?: throw mediaError(SnapCutMediaError.EXPORT_RESAMPLE_FAILED)

  override fun reset() {
    val current = handle.get()
    if (current == CLOSED_HANDLE) return
    if (NativeExportCodecBridge.resetResampler(current) != STATUS_OK) {
      throw mediaError(SnapCutMediaError.EXPORT_RESAMPLE_FAILED)
    }
  }

  override fun close() = cancel()

  override fun cancel() {
    val current = handle.getAndSet(CLOSED_HANDLE)
    if (current == CLOSED_HANDLE) return
    hooks.detach(this)
    NativeExportCodecBridge.closeResampler(current)
  }

  private fun requireHandle(): Long = handle.get().takeIf { it != CLOSED_HANDLE }
    ?: throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
}

private class NativeCompositionEncoder(
  config: CompositionEncoderConfig
) : CompositionEncoder {
  private val validatedConfig = config.also {
    require(it.sampleRateHz in ClipPcmTransformer.SUPPORTED_OUTPUT_RATES)
    require(it.channelCount in 1..2 && it.totalFrames > 0L)
    require(it.title.isNotBlank())
  }
  private val errorSet = errorSet(validatedConfig.format)
  private val channels = validatedConfig.channelCount
  private val hooks = validatedConfig.hooks
  private val finished = AtomicBoolean(false)
  private val handle = AtomicLong(
    NativeExportCodecBridge.createEncoder(validatedConfig).also {
      if (it <= 0L) throw mediaError(errorSet.init)
    }
  )

  init {
    hooks.attach(this)
  }

  override fun write(interleaved: FloatArray, frameCount: Int) {
    if (finished.get()) throw mediaError(errorSet.encode)
    require(frameCount in 1..ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES)
    require(interleaved.size == frameCount * channels)
    if (NativeExportCodecBridge.writeEncoder(requireHandle(), interleaved, frameCount) != STATUS_OK) {
      throw mediaError(errorSet.encode)
    }
  }

  override fun finish() {
    if (!finished.compareAndSet(false, true)) return
    if (NativeExportCodecBridge.finishEncoder(requireHandle()) != STATUS_OK) {
      throw mediaError(errorSet.encode)
    }
  }

  override fun close() = cancel()

  override fun cancel() {
    val current = handle.getAndSet(CLOSED_HANDLE)
    if (current == CLOSED_HANDLE) return
    hooks.detach(this)
    NativeExportCodecBridge.closeEncoder(current)
  }

  private fun requireHandle(): Long = handle.get().takeIf { it != CLOSED_HANDLE }
    ?: throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)

  private data class EncoderErrors(
    val init: SnapCutMediaError,
    val encode: SnapCutMediaError
  )

  private companion object {
    fun errorSet(format: ExportFormat): EncoderErrors = when (format) {
      ExportFormat.MP3 -> EncoderErrors(
        SnapCutMediaError.MP3_ENCODER_INIT_FAILED,
        SnapCutMediaError.MP3_ENCODER_FAILED
      )
      ExportFormat.M4A -> throw mediaError(SnapCutMediaError.EXPORT_FORMAT_UNAVAILABLE)
    }
  }
}

/** Name-based JNI surface kept in this independent file; all handles remain opaque. */
internal object NativeExportCodecBridge {
  fun createResampler(inputRate: Int, outputRate: Int, channels: Int): Long {
    requireNativeLibrary()
    return runCatching { nativeCreateResampler(inputRate, outputRate, channels) }.getOrDefault(0L)
  }

  fun resamplerMaxOutputFrames(): Int {
    requireNativeLibrary()
    return runCatching { nativeResamplerMaxOutputFrames() }.getOrDefault(STATUS_NATIVE_ERROR)
  }

  fun standardUtf8Bytes(value: String): ByteArray? {
    requireNativeLibrary()
    return runCatching { nativeStandardUtf8Bytes(value) }.getOrNull()
  }

  fun processResampler(
    handle: Long,
    interleaved: FloatArray,
    frameCount: Int,
    endOfInput: Boolean
  ): FloatArray? {
    requireNativeLibrary()
    return runCatching {
      nativeProcessResampler(handle, interleaved, frameCount, endOfInput)
    }.getOrNull()
  }

  fun resetResampler(handle: Long): Int {
    requireNativeLibrary()
    return runCatching { nativeResetResampler(handle) }.getOrDefault(STATUS_NATIVE_ERROR)
  }

  fun closeResampler(handle: Long): Int {
    if (!NativeCodecBridge.isLoaded) return STATUS_NATIVE_ERROR
    return runCatching { nativeCloseResampler(handle) }.getOrDefault(STATUS_NATIVE_ERROR)
  }

  fun createEncoder(config: CompositionEncoderConfig): Long {
    requireNativeLibrary()
    return when (config.format) {
      ExportFormat.MP3 -> runCatching {
        nativeCreateMp3Encoder(
          config.outputFile.absolutePath,
          config.sampleRateHz,
          config.channelCount,
          config.title
        )
      }.getOrDefault(0L)
      ExportFormat.M4A -> 0L
    }
  }

  fun writeEncoder(handle: Long, pcm: FloatArray, frameCount: Int): Int {
    requireNativeLibrary()
    return runCatching { nativeWriteEncoder(handle, pcm, frameCount) }
      .getOrDefault(STATUS_NATIVE_ERROR)
  }

  fun finishEncoder(handle: Long): Int {
    requireNativeLibrary()
    return runCatching { nativeFinishEncoder(handle) }.getOrDefault(STATUS_NATIVE_ERROR)
  }

  fun closeEncoder(handle: Long): Int {
    if (!NativeCodecBridge.isLoaded) return STATUS_NATIVE_ERROR
    return runCatching { nativeCloseEncoder(handle) }.getOrDefault(STATUS_NATIVE_ERROR)
  }

  private fun requireNativeLibrary() {
    if (!NativeCodecBridge.isLoaded) {
      throw mediaError(SnapCutMediaError.NATIVE_LIBRARY_LOAD_FAILED)
    }
  }

  private external fun nativeCreateResampler(
    inputRate: Int,
    outputRate: Int,
    channels: Int
  ): Long

  private external fun nativeResamplerMaxOutputFrames(): Int
  private external fun nativeStandardUtf8Bytes(value: String): ByteArray?

  private external fun nativeProcessResampler(
    handle: Long,
    interleaved: FloatArray,
    frameCount: Int,
    endOfInput: Boolean
  ): FloatArray?

  private external fun nativeResetResampler(handle: Long): Int
  private external fun nativeCloseResampler(handle: Long): Int

  private external fun nativeCreateMp3Encoder(
    path: String,
    sampleRateHz: Int,
    channelCount: Int,
    title: String
  ): Long

  private external fun nativeWriteEncoder(handle: Long, pcm: FloatArray, frameCount: Int): Int
  private external fun nativeFinishEncoder(handle: Long): Int
  private external fun nativeCloseEncoder(handle: Long): Int
}

private const val CLOSED_HANDLE = 0L
private const val STATUS_OK = 0
private const val STATUS_NATIVE_ERROR = -1
