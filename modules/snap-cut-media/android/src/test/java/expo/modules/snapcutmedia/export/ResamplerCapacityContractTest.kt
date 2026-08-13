package expo.modules.snapcutmedia.export

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ResamplerCapacityContractTest {
  @Test
  fun `worst legal 8k to 48k chunk fits the derived bounded capacity`() {
    assertEquals(
      ResamplerCapacityContract.MAX_OUTPUT_FRAMES,
      ResamplerCapacityContract.requiredOutputFrames(
        inputFrames = ResamplerCapacityContract.MAX_INPUT_FRAMES,
        inputRateHz = 8_000,
        outputRateHz = 48_000
      )
    )
    assertEquals(77_824, ResamplerCapacityContract.MAX_OUTPUT_FRAMES)
  }

  @Test
  fun `all supported source rate families and output rates stay within capacity`() {
    val supportedInputRates = listOf(
      8_000,
      11_025,
      12_000,
      16_000,
      22_050,
      24_000,
      32_000,
      44_100,
      48_000,
      88_200,
      96_000,
      176_400,
      192_000,
      352_800,
      384_000
    )

    supportedInputRates.forEach { inputRate ->
      ResamplerCapacityContract.supportedOutputRates.forEach { outputRate ->
        listOf(0, 1, 4_096, ResamplerCapacityContract.MAX_INPUT_FRAMES).forEach { frames ->
          val capacity = ResamplerCapacityContract.requiredOutputFrames(
            inputFrames = frames,
            inputRateHz = inputRate,
            outputRateHz = outputRate
          )
          val minimumConvertedFrames = kotlin.math.ceil(
            frames.toDouble() * outputRate / inputRate
          ).toInt()
          assertTrue(capacity >= minimumConvertedFrames)
          assertTrue(capacity <= ResamplerCapacityContract.MAX_OUTPUT_FRAMES)
        }
      }
    }
  }

  @Test
  fun `rates or chunks outside the export contract are rejected`() {
    val invalidRequests = listOf(
      Triple(-1, 8_000, 48_000),
      Triple(8_193, 8_000, 48_000),
      Triple(8_192, 7_999, 48_000),
      Triple(8_192, 384_001, 48_000),
      Triple(8_192, 8_000, 96_000)
    )

    invalidRequests.forEach { (frames, inputRate, outputRate) ->
      assertTrue(
        runCatching {
          ResamplerCapacityContract.requiredOutputFrames(frames, inputRate, outputRate)
        }.isFailure
      )
    }
  }
}
