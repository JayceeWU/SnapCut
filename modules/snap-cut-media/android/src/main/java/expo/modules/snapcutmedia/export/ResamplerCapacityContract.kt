package expo.modules.snapcutmedia.export

/**
 * Bounded allocation contract shared by the decoded-export pipeline and its JNI resampler.
 *
 * The largest supported conversion is one full 8,192-frame decoder chunk from 8 kHz to
 * 48 kHz. The two guard regions cover the stateful sinc filter's input history and final
 * output drain without turning the native allocation into an open-ended size request.
 */
internal object ResamplerCapacityContract {
  const val MIN_INPUT_SAMPLE_RATE_HZ = 8_000
  const val MAX_INPUT_SAMPLE_RATE_HZ = 384_000
  const val MAX_INPUT_FRAMES = 8_192
  const val FILTER_INPUT_GUARD_FRAMES = 4_096
  const val FILTER_OUTPUT_GUARD_FRAMES = 4_096
  const val MIN_OUTPUT_BUFFER_FRAMES = 4_096

  val supportedOutputRates = setOf(32_000, 44_100, 48_000)

  // ceil((8192 + 4096) * 48000 / 8000) + 4096
  const val MAX_OUTPUT_FRAMES = 77_824

  fun requiredOutputFrames(
    inputFrames: Int,
    inputRateHz: Int,
    outputRateHz: Int
  ): Int {
    require(inputFrames in 0..MAX_INPUT_FRAMES)
    require(inputRateHz in MIN_INPUT_SAMPLE_RATE_HZ..MAX_INPUT_SAMPLE_RATE_HZ)
    require(outputRateHz in supportedOutputRates)

    val guardedInputFrames = inputFrames.toLong() + FILTER_INPUT_GUARD_FRAMES
    val scaledFrames = ceilDivide(
      guardedInputFrames * outputRateHz,
      inputRateHz.toLong()
    )
    val requiredFrames = maxOf(
      MIN_OUTPUT_BUFFER_FRAMES.toLong(),
      scaledFrames + FILTER_OUTPUT_GUARD_FRAMES
    )
    check(requiredFrames <= MAX_OUTPUT_FRAMES) {
      "Resampler output capacity exceeds its bounded allocation contract"
    }
    return requiredFrames.toInt()
  }

  private fun ceilDivide(numerator: Long, denominator: Long): Long =
    (numerator + denominator - 1L) / denominator
}
