package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class ExportCommitGateTest {
  @Test
  fun `cancellation before commit is accepted and commit is rejected`() {
    val gate = ExportCommitGate()
    gate.begin("export-1", 3L)

    assertTrue(gate.requestCancellation("export-1"))
    val error = assertThrows(SnapCutMediaException::class.java) {
      gate.boundary("export-1", 3L).commit { true }
    }

    assertEquals("EXPORT_CANCELLED", error.code)
  }

  @Test
  fun `cancellation racing publication loses after irreversible commit begins`() {
    val gate = ExportCommitGate()
    gate.begin("export-1", 3L)
    val publishing = CountDownLatch(1)
    val allowPublish = CountDownLatch(1)
    val publishResult = AtomicReference<Boolean?>()
    val publishError = AtomicReference<Throwable?>()
    val cancellationResult = AtomicReference<Boolean?>()

    val publisher = thread(start = true) {
      try {
        publishResult.set(gate.boundary("export-1", 3L).commit {
          publishing.countDown()
          check(allowPublish.await(5, TimeUnit.SECONDS))
          true
        })
      } catch (error: Throwable) {
        publishError.set(error)
      }
    }
    assertTrue(publishing.await(5, TimeUnit.SECONDS))

    val cancellationStarted = CountDownLatch(1)
    val canceller = thread(start = true) {
      cancellationStarted.countDown()
      cancellationResult.set(gate.requestCancellation("export-1"))
    }
    assertTrue(cancellationStarted.await(5, TimeUnit.SECONDS))
    assertNull(cancellationResult.get())
    allowPublish.countDown()
    publisher.join(5_000)
    canceller.join(5_000)

    assertFalse(publisher.isAlive)
    assertFalse(canceller.isAlive)
    assertNull(publishError.get())
    assertEquals(true, publishResult.get())
    assertEquals(false, cancellationResult.get())
  }

  @Test
  fun `committed entry protects success until native job completion`() {
    val gate = ExportCommitGate()
    gate.begin("export-1", 3L)

    assertTrue(gate.boundary("export-1", 3L).commit { true })
    assertFalse(gate.requestCancellation("export-1"))
    gate.complete("export-1", 3L)
    assertTrue(gate.requestCancellation("export-1"))
  }
}
