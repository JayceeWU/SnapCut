package expo.modules.snapcutmedia.export

import android.media.MediaExtractor
import android.media.MediaFormat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.PI
import kotlin.math.sin

@RunWith(AndroidJUnit4::class)
class NativeExportCodecInstrumentedTest {
  @Test
  fun nativeStringsUseStandardUtf8AndRejectInvalidUtf16() {
    val title = "SnapCut \u2702\uFE0F \uD83D\uDC9C"
    val encoded = NativeExportCodecBridge.standardUtf8Bytes(title)
    assertNotNull(encoded)
    assertArrayEquals(title.toByteArray(Charsets.UTF_8), encoded!!)
    assertNull(NativeExportCodecBridge.standardUtf8Bytes(""))
    assertNull(NativeExportCodecBridge.standardUtf8Bytes("bad\u0000title"))
    assertNull(
      NativeExportCodecBridge.standardUtf8Bytes(charArrayOf('\uD83D').concatToString())
    )
    assertNull(
      NativeExportCodecBridge.standardUtf8Bytes(charArrayOf('\uDC9C').concatToString())
    )
  }

  @Test
  fun nativeCapacityMatchesKotlinContractAndAcceptsWorstLegalUpsampleChunk() {
    assertEquals(
      ResamplerCapacityContract.MAX_OUTPUT_FRAMES,
      NativeExportCodecBridge.resamplerMaxOutputFrames()
    )
    val handle = NativeExportCodecBridge.createResampler(8_000, 48_000, 2)
    assertTrue(handle > 0L)
    try {
      val input = FloatArray(ResamplerCapacityContract.MAX_INPUT_FRAMES * 2) { sample ->
        val frame = sample / 2
        sin(frame * 2.0 * PI * 440.0 / 8_000.0).toFloat()
      }
      val first = NativeExportCodecBridge.processResampler(
        handle,
        input,
        ResamplerCapacityContract.MAX_INPUT_FRAMES,
        false
      )
      assertNotNull(first)
      assertTrue(first!!.isNotEmpty())
      assertTrue(first.size <= ResamplerCapacityContract.MAX_OUTPUT_FRAMES * 2)

      repeat(8) {
        val tail = NativeExportCodecBridge.processResampler(handle, FloatArray(0), 0, true)
        assertNotNull(tail)
        assertTrue(tail!!.size <= ResamplerCapacityContract.MAX_OUTPUT_FRAMES * 2)
      }
    } finally {
      assertEquals(0, NativeExportCodecBridge.closeResampler(handle))
    }
  }

  @Test
  fun nativeResamplerAcceptsAllOutputRatesAtInputRateBoundaries() {
    listOf(8_000, 384_000).forEach { inputRate ->
      ResamplerCapacityContract.supportedOutputRates.forEach { outputRate ->
        val handle = NativeExportCodecBridge.createResampler(inputRate, outputRate, 1)
        assertTrue(handle > 0L)
        try {
          assertNotNull(
            NativeExportCodecBridge.processResampler(
              handle,
              FloatArray(128),
              128,
              false
            )
          )
        } finally {
          assertEquals(0, NativeExportCodecBridge.closeResampler(handle))
        }
      }
    }
    assertEquals(0L, NativeExportCodecBridge.createResampler(8_000, 96_000, 1))
  }

  @Test
  fun resamplerIsStatefulFlushableResettableAndNativeCloseIsIdempotent() {
    val handle = NativeExportCodecBridge.createResampler(44_100, 48_000, 1)
    assertTrue(handle > 0L)
    val input = FloatArray(4_096) { index -> sin(index * 2.0 * PI * 440.0 / 44_100.0).toFloat() }
    val first = NativeExportCodecBridge.processResampler(handle, input, input.size, false)
    assertNotNull(first)
    var outputSamples = first!!.size
    repeat(8) {
      val tail = NativeExportCodecBridge.processResampler(handle, FloatArray(0), 0, true)
      assertNotNull(tail)
      outputSamples += tail!!.size
      if (tail.isEmpty()) return@repeat
    }
    assertTrue(outputSamples > input.size)
    assertEquals(0, NativeExportCodecBridge.resetResampler(handle))
    assertEquals(0, NativeExportCodecBridge.closeResampler(handle))
    assertEquals(1, NativeExportCodecBridge.closeResampler(handle))
  }

  @Test
  fun mp3320EncodesOneCompositionAndPassesFreshExtractorValidation() {
    val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    val root = File(context.cacheDir, "snapcut-export-jni-${System.nanoTime()}")
    assertTrue(root.mkdirs())
    try {
      val frames = 4_800
      val pcm = FloatArray(frames * 2) { sample ->
        val frame = sample / 2
        (0.25 * sin(frame * 2.0 * PI * 440.0 / 48_000.0)).toFloat()
      }
      listOf(ExportFormat.MP3).forEach { format ->
        val file = File(root, "test.mp3")
        val handle = NativeExportCodecBridge.createEncoder(
          CompositionEncoderConfig(
            format = format,
            outputFile = file,
            sampleRateHz = 48_000,
            channelCount = 2,
            totalFrames = frames.toLong(),
            title = "SnapCut JNI test"
          )
        )
        assertTrue(handle > 0L)
        var offset = 0
        while (offset < frames) {
          val count = minOf(1_024, frames - offset)
          val chunk = pcm.copyOfRange(offset * 2, (offset + count) * 2)
          assertEquals(0, NativeExportCodecBridge.writeEncoder(handle, chunk, count))
          offset += count
        }
        assertEquals(0, NativeExportCodecBridge.finishEncoder(handle))
        assertEquals(0, NativeExportCodecBridge.closeEncoder(handle))
        assertEquals(1, NativeExportCodecBridge.closeEncoder(handle))
        assertTrue(file.isFile && file.length() > 0L)

        val extractor = MediaExtractor()
        try {
          extractor.setDataSource(file.absolutePath)
          val audio = (0 until extractor.trackCount).mapNotNull { index ->
            extractor.getTrackFormat(index).takeIf {
              it.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            }
          }.single()
          assertEquals(48_000, audio.getInteger(MediaFormat.KEY_SAMPLE_RATE))
          assertEquals(2, audio.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
        } finally {
          extractor.release()
        }

        val verified = try {
          CompletedDecodedOutputVerifier().verify(
            file = file,
            format = format,
            expectedFrames = frames.toLong(),
            expectedSampleRateHz = 48_000,
            expectedChannelCount = 2,
            cancellation = CancellationCheck.NONE,
            hooks = MediaResourceHooks.NONE
          )
        } catch (error: SnapCutMediaException) {
          throw AssertionError(
            "${format.name} verifier failed at ${error.technicalContext ?: "unclassified"}",
            error
          )
        }
        assertEquals(48_000, verified.sampleRateHz)
        assertEquals(2, verified.channelCount)
      }
    } finally {
      root.deleteRecursively()
    }
  }
}
