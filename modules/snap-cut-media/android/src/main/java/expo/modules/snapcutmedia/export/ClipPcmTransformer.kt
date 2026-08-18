package expo.modules.snapcutmedia.export

import java.io.Closeable

internal fun interface FloatPcmSink {
  fun write(interleaved: FloatArray, frameCount: Int)
}

internal interface StatefulResampler : Closeable {
  fun process(interleaved: FloatArray, frameCount: Int): FloatArray
  fun flush(): FloatArray
  fun reset()
}

internal fun interface StatefulResamplerFactory {
  fun create(inputRate: Int, outputRate: Int, channels: Int): StatefulResampler
}

internal class ClipPcmTransformer(
  private val outputRate: Int,
  private val outputChannels: Int,
  private val resamplerFactory: StatefulResamplerFactory,
  private val sink: FloatPcmSink
) : Closeable {
  private var inputChannels = 0
  private var resampler: StatefulResampler? = null
  private var clipOpen = false

  init {
    require(outputRate in SUPPORTED_OUTPUT_RATES && outputChannels in 1..2)
  }

  fun beginClip(inputRate: Int, inputChannels: Int) {
    check(!clipOpen)
    require(
      inputRate in ResamplerCapacityContract.MIN_INPUT_SAMPLE_RATE_HZ..
        ResamplerCapacityContract.MAX_INPUT_SAMPLE_RATE_HZ && inputChannels in 1..2
    )
    require(!(inputChannels == 2 && outputChannels == 1))
    this.inputChannels = inputChannels
    resampler = if (inputRate == outputRate) null else {
      resamplerFactory.create(inputRate, outputRate, outputChannels)
    }
    clipOpen = true
  }

  fun write(interleaved: FloatArray, frameCount: Int) {
    check(clipOpen)
    require(frameCount in 0..MAX_PCM_CHUNK_FRAMES)
    require(interleaved.size == frameCount * inputChannels)
    if (frameCount == 0) return
    val converted = DecodedPcm.convertChannels(interleaved, inputChannels, outputChannels)
    writeBounded(resampler?.process(converted, frameCount) ?: converted)
  }

  fun finishClip() {
    check(clipOpen)
    try {
      val active = resampler
      if (active != null) {
        var complete = false
        var attempts = 0
        while (!complete && attempts < MAX_FLUSH_ITERATIONS) {
          val tail = active.flush()
          if (tail.isEmpty()) complete = true else writeBounded(tail)
          attempts += 1
        }
        check(complete) { "Resampler did not finish within bounded flush iterations" }
      }
    } finally {
      runCatching { resampler?.reset() }
      runCatching { resampler?.close() }
      resampler = null
      inputChannels = 0
      clipOpen = false
    }
  }

  override fun close() {
    if (clipOpen) {
      runCatching { resampler?.reset() }
      runCatching { resampler?.close() }
      resampler = null
      inputChannels = 0
      clipOpen = false
    }
  }

  private fun writeBounded(interleaved: FloatArray) {
    require(interleaved.size % outputChannels == 0)
    var offset = 0
    val total = interleaved.size / outputChannels
    while (offset < total) {
      val frames = minOf(MAX_PCM_CHUNK_FRAMES, total - offset)
      val first = offset * outputChannels
      sink.write(interleaved.copyOfRange(first, first + frames * outputChannels), frames)
      offset += frames
    }
  }

  companion object {
    const val MAX_PCM_CHUNK_FRAMES = ResamplerCapacityContract.MAX_INPUT_FRAMES
    private const val MAX_FLUSH_ITERATIONS = 8
    val SUPPORTED_OUTPUT_RATES = ResamplerCapacityContract.supportedOutputRates
  }
}
