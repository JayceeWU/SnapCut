package expo.modules.snapcutmedia.source

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.fixtures.FixtureUris
import expo.modules.snapcutmedia.fixtures.RuntimeMediaFixtures
import expo.modules.snapcutmedia.fixtures.freshFixtureDirectory
import expo.modules.snapcutmedia.models.SourceKind
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.File

@RunWith(AndroidJUnit4::class)
class RuntimeMediaInstrumentedTest {
  private val testContext = InstrumentationRegistry.getInstrumentation().context
  private val resolver = testContext.contentResolver
  private lateinit var spoolRoot: File
  private lateinit var inspector: SourceInspector

  @Before
  fun setUp() {
    spoolRoot = freshFixtureDirectory(testContext, "runtime-media-spool")
    inspector = SourceInspector(resolver, spoolRoot)
  }

  @After
  fun tearDown() {
    spoolRoot.deleteRecursively()
  }

  @Test
  fun generatedPcmWavIsExtractedAndClassifiedByRuntimeMediaApis() {
    val uri = FixtureUris.build(
      "wav",
      "transport" to "file",
      "cursorSize" to "actual",
      "assetSize" to "actual"
    )

    val inspection = inspector.inspect(
      uri.toString(),
      RuntimeMediaFixtures.pcmWav.size + 1_024L
    )

    assertEquals(SourceKind.WAV, inspection.sourceKind)
    assertEquals(44_100, inspection.sampleRateHz)
    assertEquals(1, inspection.channelCount)
    assertTrue(inspection.durationMs in 240L..260L)
    assertEquals(RuntimeMediaFixtures.pcmWav.size.toLong(), inspection.fileSizeBytes)
    assertFalse(inspection.requiresStreamingSizeVerification)
    assertFalse(inspection.drmProtected)
  }

  @Test
  fun runtimeEncodedMp3WinsOverM4sNameAndIncorrectProviderMime() {
    val generated = RuntimeMediaFixtures.legalMp3(testContext.cacheDir)
    assertTrue(generated.isNotEmpty())
    val uri = FixtureUris.build(
      "mp3-renamed-m4s",
      "transport" to "file",
      "cursorSize" to "actual",
      "assetSize" to "actual",
      "token" to "opaque-mp3-capability"
    )

    resolver.query(
      uri,
      arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
      null,
      null,
      null
    )!!.use { cursor ->
      assertTrue(cursor.moveToFirst())
      assertTrue(cursor.getString(0).endsWith(".m4s"))
    }
    assertEquals("video/iso.segment", resolver.getType(uri))

    val inspection = inspector.inspect(uri.toString(), 2L * 1024L * 1024L)

    assertEquals(SourceKind.MP3, inspection.sourceKind)
    assertEquals("audio/mpeg", inspection.codecMime)
    assertEquals(44_100, inspection.sampleRateHz)
    assertEquals(1, inspection.channelCount)
    assertTrue(inspection.durationMs > 0L)
    assertFalse(inspection.drmProtected)
  }

  @Test
  fun structuralMediaFragmentWithoutInitializationUsesStableM4sError() {
    val fixture = RuntimeMediaFixtures.fragmentWithoutInitialization
    val probe = ContainerProbe.read(ByteArrayInputStream(fixture))
    assertTrue(probe.isIsoBmff)
    assertTrue(probe.hasMovieFragmentBox)
    assertFalse(probe.hasMovieBox)
    assertTrue(probe.isFragmentMissingInitialization)

    val uri = FixtureUris.build(
      "fragment",
      "transport" to "file",
      "cursorSize" to "actual",
      "assetSize" to "actual"
    )
    val error = assertThrows(SnapCutMediaException::class.java) {
      inspector.inspect(uri.toString(), fixture.size + 1_024L)
    }
    assertEquals("M4S_INIT_MISSING", error.code)
  }
}
