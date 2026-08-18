package expo.modules.snapcutmedia.source

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.fixtures.FixtureUris
import expo.modules.snapcutmedia.fixtures.RuntimeMediaFixtures
import expo.modules.snapcutmedia.fixtures.TrackingResourceHooks
import expo.modules.snapcutmedia.fixtures.freshFixtureDirectory
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class SourceProviderInstrumentedTest {
  private val testContext = InstrumentationRegistry.getInstrumentation().context
  private val resolver = testContext.contentResolver
  private lateinit var spoolRoot: File

  @Before
  fun setUp() {
    spoolRoot = freshFixtureDirectory(testContext, "source-provider-spool")
  }

  @After
  fun tearDown() {
    spoolRoot.deleteRecursively()
  }

  @Test
  fun opaqueQueryUriAndNullZeroNegativeSizesUseBoundedNonSeekableSpooling() {
    listOf("null", "zero", "minus-one").forEach { cursorSize ->
      val uri = FixtureUris.build(
        "wav",
        "transport" to "pipe",
        "cursorSize" to cursorSize,
        "assetSize" to "minus-one",
        "token" to "opaque/$cursorSize?capability=private"
      )

      SourceSession.open(
        resolver,
        uri.toString(),
        RuntimeMediaFixtures.pcmWav.size + 1_024L,
        spoolRoot
      ).use { session ->
        assertEquals(uri.toString(), session.sourceUri.toString())
        assertEquals(RuntimeMediaFixtures.pcmWav.size.toLong(), session.actualSizeBytes)
        assertTrue(session.requiresStreamingSizeVerification)
        assertTrue(session.containerProbe.isWave)
      }
      assertTrue(spoolRoot.listFiles().orEmpty().isEmpty())
    }
  }

  @Test
  fun contradictoryCursorAssetAndStatSizesAreVerifiedAgainstTheStream() {
    val uri = FixtureUris.build(
      "wav",
      "transport" to "file",
      "cursorSize" to "actual-minus-one",
      "assetSize" to "actual-plus-one"
    )

    SourceSession.open(
      resolver,
      uri.toString(),
      RuntimeMediaFixtures.pcmWav.size + 1_024L,
      spoolRoot
    ).use { session ->
      assertTrue(session.requiresStreamingSizeVerification)
      assertEquals(RuntimeMediaFixtures.pcmWav.size.toLong(), session.actualSizeBytes)
      assertTrue(session.containerProbe.isWave)
    }
    assertTrue(spoolRoot.listFiles().orEmpty().isEmpty())
  }

  @Test
  fun configuredLimitAcceptsExactBytesAndRejectsTheSentinelByte() {
    val limit = 128 * 1024
    val exact = FixtureUris.build(
      "bytes",
      "length" to limit.toString(),
      "transport" to "pipe",
      "cursorSize" to "null",
      "assetSize" to "minus-one"
    )
    SourceSession.open(resolver, exact.toString(), limit.toLong(), spoolRoot).use { session ->
      assertEquals(limit.toLong(), session.actualSizeBytes)
    }
    assertTrue(spoolRoot.listFiles().orEmpty().isEmpty())

    val oneTooMany = FixtureUris.build(
      "bytes",
      "length" to (limit + 1).toString(),
      "transport" to "pipe",
      "cursorSize" to "null",
      "assetSize" to "minus-one"
    )
    val error = assertThrows(SnapCutMediaException::class.java) {
      SourceSession.open(resolver, oneTooMany.toString(), limit.toLong(), spoolRoot)
    }
    assertEquals("SOURCE_TOO_LARGE", error.code)
    assertTrue(spoolRoot.listFiles().orEmpty().isEmpty())
  }

  @Test
  fun permissionRevokedAfterMetadataDoesNotLeakTheOpaqueToken() {
    val secret = "do-not-log-query-capability"
    val uri = FixtureUris.build(
      "wav",
      "transport" to "file",
      "cursorSize" to "actual",
      "assetSize" to "actual",
      "deny" to "all",
      "token" to secret
    )

    val error = assertThrows(SnapCutMediaException::class.java) {
      SourceSession.open(
        resolver,
        uri.toString(),
        RuntimeMediaFixtures.pcmWav.size + 1_024L,
        spoolRoot
      )
    }

    assertEquals("SOURCE_PERMISSION_DENIED", error.code)
    assertFalse(error.toString().contains(secret))
    assertFalse(error.message.orEmpty().contains(secret))
    assertNull(error.technicalContext)
    assertNull(error.cause)
  }

  @Test
  fun slowPipeCancellationClosesAttachedResourcesAndRemovesTheSpool() {
    val cancelled = AtomicBoolean(false)
    val hooks = TrackingResourceHooks()
    val uri = FixtureUris.build(
      "bytes",
      "length" to (1024 * 1024).toString(),
      "transport" to "slow",
      "delayMs" to "100",
      "cursorSize" to "null",
      "assetSize" to "minus-one"
    )
    val cancellation = CancellationCheck {
      if (cancelled.get()) throw mediaError(SnapCutMediaError.IMPORT_CANCELLED)
    }
    val executor = Executors.newSingleThreadExecutor()
    try {
      val result = executor.submit<Throwable?> {
        try {
          SourceSession.open(
            resolver,
            uri.toString(),
            2L * 1024L * 1024L,
            spoolRoot,
            cancellation,
            hooks
          ).close()
          null
        } catch (error: Throwable) {
          error
        }
      }

      assertTrue(hooks.awaitAttachment())
      cancelled.set(true)
      hooks.cancelAttached()
      val error = result.get(5L, TimeUnit.SECONDS)
      assertTrue(error is SnapCutMediaException)
      assertEquals("IMPORT_CANCELLED", (error as SnapCutMediaException).code)
      assertTrue(hooks.awaitIdle())
      assertEquals(hooks.attachmentCount.get(), hooks.detachmentCount.get())
      assertTrue(spoolRoot.listFiles().orEmpty().isEmpty())
    } finally {
      executor.shutdownNow()
    }
  }

  @Test
  fun missingNameAndMimeRemainAdvisory() {
    val uri = FixtureUris.build(
      "wav",
      "name" to "null",
      "mime" to "null",
      "cursorSize" to "null"
    )
    resolver.query(
      uri,
      arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
      null,
      null,
      null
    )!!.use { cursor ->
      assertTrue(cursor.moveToFirst())
      assertTrue(cursor.isNull(0))
    }
    assertNull(resolver.getType(uri))
  }
}
