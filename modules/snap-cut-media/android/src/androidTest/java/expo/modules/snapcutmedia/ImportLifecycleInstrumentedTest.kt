package expo.modules.snapcutmedia.importmedia

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.fixtures.FixtureUris
import expo.modules.snapcutmedia.fixtures.RuntimeMediaFixtures
import expo.modules.snapcutmedia.fixtures.TrackingResourceHooks
import expo.modules.snapcutmedia.fixtures.freshFixtureDirectory
import expo.modules.snapcutmedia.models.ImportSourceRequest
import expo.modules.snapcutmedia.models.SourceKind
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.SourceInspector
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class ImportLifecycleInstrumentedTest {
  private val testContext = InstrumentationRegistry.getInstrumentation().context
  private lateinit var spoolRoot: File
  private lateinit var stagingRoot: File
  private lateinit var service: MediaImportService

  @Before
  fun setUp() {
    spoolRoot = freshFixtureDirectory(testContext, "import-lifecycle-spool")
    stagingRoot = freshFixtureDirectory(testContext, "import-lifecycle-staging")
    service = MediaImportService(
      SourceInspector(testContext.contentResolver, spoolRoot),
      listOf(stagingRoot)
    )
  }

  @After
  fun tearDown() {
    spoolRoot.deleteRecursively()
    stagingRoot.deleteRecursively()
  }

  @Test
  fun successFailureCancellationThenSuccessLeavesEveryResourceSlotReusable() {
    val wavUri = FixtureUris.build(
      "wav",
      "transport" to "file",
      "cursorSize" to "actual",
      "assetSize" to "actual"
    ).toString()

    val firstHooks = TrackingResourceHooks()
    val firstRequest = request("success-one", wavUri, "source-one.wav.partial")
    val first = service.importSource(firstRequest, CancellationCheck.NONE, firstHooks)
    assertEquals(firstRequest.outputFileUri, first.outputFileUri)
    assertEquals(SourceKind.WAV, first.sourceKind)
    assertEquals(RuntimeMediaFixtures.pcmWav.size.toLong(), first.fileSizeBytes)
    assertTrue(first.privateAudioSha256.matches(Regex("[0-9a-f]{64}")))
    assertResourceHooksIdle(firstHooks)

    val deniedUri = FixtureUris.build(
      "wav",
      "transport" to "file",
      "deny" to "all",
      "token" to "must-not-escape"
    ).toString()
    val failedHooks = TrackingResourceHooks()
    val failedRequest = request("permission-failure", deniedUri, "source-failed.wav.partial")
    val failure = assertThrows(SnapCutMediaException::class.java) {
      service.importSource(failedRequest, CancellationCheck.NONE, failedHooks)
    }
    assertEquals("SOURCE_PERMISSION_DENIED", failure.code)
    assertFalse(File(URI(failedRequest.outputFileUri)).exists())
    assertResourceHooksIdle(failedHooks, requireAttachment = false)

    val cancelled = AtomicBoolean(false)
    val cancellationHooks = TrackingResourceHooks()
    val slowUri = FixtureUris.build(
      "bytes",
      "length" to (1024 * 1024).toString(),
      "transport" to "slow",
      "delayMs" to "100",
      "cursorSize" to "null",
      "assetSize" to "minus-one"
    ).toString()
    val cancelledRequest = request(
      "cancelled-import",
      slowUri,
      "source-cancelled.wav.partial",
      2L * 1024L * 1024L
    )
    val cancellation = CancellationCheck {
      if (cancelled.get()) throw mediaError(SnapCutMediaError.IMPORT_CANCELLED)
    }
    val executor = Executors.newSingleThreadExecutor()
    try {
      val result = executor.submit<Throwable?> {
        try {
          service.importSource(cancelledRequest, cancellation, cancellationHooks)
          null
        } catch (error: Throwable) {
          error
        }
      }
      assertTrue(cancellationHooks.awaitAttachment())
      cancelled.set(true)
      cancellationHooks.cancelAttached()
      val cancellationError = result.get(5L, TimeUnit.SECONDS)
      assertTrue(cancellationError is SnapCutMediaException)
      assertEquals("IMPORT_CANCELLED", (cancellationError as SnapCutMediaException).code)
      assertTrue(cancellationHooks.awaitIdle())
      assertEquals(
        cancellationHooks.attachmentCount.get(),
        cancellationHooks.detachmentCount.get()
      )
      assertFalse(File(URI(cancelledRequest.outputFileUri)).exists())
      assertTrue(spoolRoot.listFiles().orEmpty().isEmpty())
    } finally {
      executor.shutdownNow()
    }

    val finalHooks = TrackingResourceHooks()
    val finalRequest = request("success-two", wavUri, "source-two.wav.partial")
    val finalResult = service.importSource(finalRequest, CancellationCheck.NONE, finalHooks)
    assertEquals(SourceKind.WAV, finalResult.sourceKind)
    assertTrue(File(URI(finalResult.outputFileUri)).isFile)
    assertResourceHooksIdle(finalHooks)
  }

  private fun request(
    jobId: String,
    sourceUri: String,
    fileName: String,
    maxSourceBytes: Long = RuntimeMediaFixtures.pcmWav.size + 1_024L
  ): ImportSourceRequest {
    val output = File(stagingRoot, ".import-$jobId/$fileName")
    return ImportSourceRequest(
      jobId = jobId,
      generation = 1L,
      sourceUri = sourceUri,
      outputFileUri = output.toURI().toString(),
      maxSourceBytes = maxSourceBytes
    )
  }

  private fun assertResourceHooksIdle(
    hooks: TrackingResourceHooks,
    requireAttachment: Boolean = true
  ) {
    assertTrue(hooks.isIdle())
    if (requireAttachment) assertTrue(hooks.attachmentCount.get() > 0)
    assertEquals(hooks.attachmentCount.get(), hooks.detachmentCount.get())
  }
}
