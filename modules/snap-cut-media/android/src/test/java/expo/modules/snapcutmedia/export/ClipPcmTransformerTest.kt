package expo.modules.snapcutmedia.export

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipPcmTransformerTest {
  @Test
  fun `resampler state is created flushed reset and closed once per clip`() {
    val created = mutableListOf<FakeResampler>()
    val writes = mutableListOf<FloatArray>()
    val transformer = ClipPcmTransformer(
      outputRate = 48_000,
      outputChannels = 2,
      resamplerFactory = StatefulResamplerFactory { input, output, channels ->
        FakeResampler(input, output, channels).also(created::add)
      },
      sink = FloatPcmSink { pcm, _ -> writes += pcm }
    )

    repeat(2) {
      transformer.beginClip(44_100, 1)
      transformer.write(floatArrayOf(0.25f, -0.5f), 2)
      transformer.finishClip()
    }

    assertEquals(2, created.size)
    created.forEach { state ->
      assertEquals(44_100, state.inputRate)
      assertEquals(48_000, state.outputRate)
      assertEquals(2, state.channels)
      assertEquals(1, state.processCalls)
      assertEquals(2, state.flushCalls)
      assertTrue(state.reset)
      assertTrue(state.closed)
    }
    assertArrayEquals(floatArrayOf(0.25f, 0.25f, -0.5f, -0.5f), writes[0], 0f)
    assertArrayEquals(floatArrayOf(0.125f, 0.125f), writes[1], 0f)
  }

  @Test
  fun `matching rates bypass resampler and output chunks stay bounded`() {
    var factoryCalled = false
    val sizes = mutableListOf<Int>()
    val transformer = ClipPcmTransformer(
      outputRate = 48_000,
      outputChannels = 1,
      resamplerFactory = StatefulResamplerFactory { _, _, _ ->
        factoryCalled = true
        error("must not be called")
      },
      sink = FloatPcmSink { _, frames -> sizes += frames }
    )

    transformer.beginClip(48_000, 1)
    transformer.write(FloatArray(ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES), 8_192)
    transformer.finishClip()

    assertFalse(factoryCalled)
    assertEquals(listOf(8_192), sizes)
  }

  @Test
  fun `worst legal upsample expansion is split into bounded encoder writes`() {
    val sizes = mutableListOf<Int>()
    val transformer = ClipPcmTransformer(
      outputRate = 48_000,
      outputChannels = 2,
      resamplerFactory = StatefulResamplerFactory { input, output, channels ->
        assertEquals(8_000, input)
        assertEquals(48_000, output)
        assertEquals(2, channels)
        SixTimesResampler(channels)
      },
      sink = FloatPcmSink { _, frames -> sizes += frames }
    )

    transformer.beginClip(8_000, 1)
    transformer.write(FloatArray(ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES), 8_192)
    transformer.finishClip()

    assertEquals(List(6) { 8_192 }, sizes)
    assertTrue(sizes.all { it <= ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES })
  }

  private class FakeResampler(
    val inputRate: Int,
    val outputRate: Int,
    val channels: Int
  ) : StatefulResampler {
    var processCalls = 0
    var flushCalls = 0
    var reset = false
    var closed = false

    override fun process(interleaved: FloatArray, frameCount: Int): FloatArray {
      processCalls += 1
      return interleaved.copyOf()
    }

    override fun flush(): FloatArray {
      flushCalls += 1
      return if (flushCalls == 1) FloatArray(channels) { 0.125f } else FloatArray(0)
    }

    override fun reset() {
      reset = true
    }

    override fun close() {
      closed = true
    }
  }

  private class SixTimesResampler(
    private val channels: Int
  ) : StatefulResampler {
    override fun process(interleaved: FloatArray, frameCount: Int): FloatArray =
      FloatArray(frameCount * 6 * channels)

    override fun flush(): FloatArray = FloatArray(0)

    override fun reset() = Unit

    override fun close() = Unit
  }
}
