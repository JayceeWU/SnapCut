package expo.modules.snapcutmedia.jobs

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.NativeOperation
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class NativeJobRegistryTest {
  @Test
  fun `one heavy media slot rejects all conflicting operation types`() {
    val registry = NativeJobRegistry()
    val importJob = Job()
    registry.register(NativeOperation.IMPORT, "import-1", 1L, importJob)

    listOf(NativeOperation.IMPORT, NativeOperation.WAVEFORM, NativeOperation.PREFLIGHT,
      NativeOperation.EXPORT).forEach { operation ->
      val error = assertThrows(SnapCutMediaException::class.java) {
        registry.register(operation, "next", 2L, Job())
      }
      assertEquals("JOB_ALREADY_RUNNING", error.code)
    }

    registry.complete(NativeOperation.IMPORT, "import-1", 1L, importJob)
    assertEquals(null, registry.activeOperation())
  }

  @Test
  fun `sequence is monotonic and scoped by job plus generation`() {
    val registry = NativeJobRegistry()
    val job = Job()
    registry.register(NativeOperation.EXPORT, "export-1", 4L, job)

    assertEquals(1L, registry.nextSequence(NativeOperation.EXPORT, "export-1", 4L))
    assertEquals(2L, registry.nextSequence(NativeOperation.EXPORT, "export-1", 4L))
    assertTrue(registry.isCurrent(NativeOperation.EXPORT, "export-1", 4L))
    assertFalse(registry.isCurrent(NativeOperation.EXPORT, "export-1", 3L))
  }

  @Test
  fun `cancel is idempotent and releases owned resources once`() {
    val registry = NativeJobRegistry()
    val job = Job()
    val releases = AtomicInteger(0)
    registry.register(NativeOperation.IMPORT, "import-1", 1L, job)
    registry.attach(NativeOperation.IMPORT, "import-1", 1L) {
      releases.incrementAndGet()
    }

    registry.cancel(NativeOperation.IMPORT, "import-1")
    registry.cancel(NativeOperation.IMPORT, "import-1")

    assertTrue(job.isCancelled)
    assertEquals(1, releases.get())
  }

  @Test
  fun `cancel and join waits for worker cleanup before returning`() = runBlocking {
    val registry = NativeJobRegistry()
    val cleanupStarted = CompletableDeferred<Unit>()
    val allowCleanupToFinish = CompletableDeferred<Unit>()
    val worker = launch(Dispatchers.Default, start = CoroutineStart.UNDISPATCHED) {
      try {
        awaitCancellation()
      } finally {
        withContext(NonCancellable) {
          cleanupStarted.complete(Unit)
          allowCleanupToFinish.await()
        }
      }
    }
    registry.register(NativeOperation.EXPORT, "export-join", 1L, worker)

    val cancellation = async(Dispatchers.Default) {
      registry.cancelAndJoin(NativeOperation.EXPORT, "export-join")
    }
    cleanupStarted.await()
    assertFalse(cancellation.isCompleted)
    allowCleanupToFinish.complete(Unit)
    cancellation.await()

    assertTrue(worker.isCompleted)
    assertTrue(worker.isCancelled)
  }

  @Test
  fun `stale preview generations cannot replace or mutate a newer session`() {
    val registry = NativeJobRegistry()

    assertTrue(registry.beginPreview("new-session", 10L))
    assertFalse(registry.beginPreview("stale-session", 9L))
    assertFalse(registry.beginPreview("different-session", 10L))
    assertTrue(registry.isCurrentPreview("new-session", 10L))
    assertFalse(registry.releasePreview("stale-session", 9L))
    assertTrue(registry.releasePreview("new-session", 10L))
    assertFalse(registry.beginPreview("different-session", 10L))
    assertTrue(registry.beginPreview("new-session", 10L))
    assertTrue(registry.isCurrentPreview("new-session", 10L))
  }

  @Test
  fun `destroy cancellation clears all active work`() {
    val registry = NativeJobRegistry()
    val job = Job()
    registry.register(NativeOperation.WAVEFORM, "wave-1", 1L, job)

    registry.cancelAll()
    registry.cancelAll()

    assertTrue(job.isCancelled)
    assertEquals(null, registry.activeOperation())
  }
}
