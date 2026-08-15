package expo.modules.snapcutmedia.export

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.jobs.NativeJobResource
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class TimelineProducerCancellationTest {
  @Test
  fun `local stop interrupts producer cancellation without cancelling the parent job`() {
    val stopped = AtomicBoolean(false)
    val check = StopAwareCancellation(CancellationCheck.NONE, stopped)
    check.throwIfCancelled()
    stopped.set(true)
    assertEquals(
      "EXPORT_CANCELLED",
      assertThrows(SnapCutMediaException::class.java, check::throwIfCancelled).code
    )
  }

  @Test
  fun `cooperative producer exits and is joined before cleanup returns`() {
    val stopped = AtomicBoolean(false)
    val started = CountDownLatch(1)
    val check = StopAwareCancellation(CancellationCheck.NONE, stopped)
    val thread = Thread {
      started.countDown()
      try {
        while (true) check.throwIfCancelled()
      } catch (_: SnapCutMediaException) {
        // Expected local cancellation.
      }
    }
    thread.start()
    started.await()
    stopped.set(true)
    thread.interrupt()
    requireThreadStopped(thread, 2_000)
    assertFalse(thread.isAlive)
  }

  @Test
  fun `track cancellation closes a blocking active resource before join`() {
    val attached = AtomicInteger()
    val detached = AtomicInteger()
    val delegate = object : MediaResourceHooks {
      override fun attach(resource: NativeJobResource) {
        attached.incrementAndGet()
      }

      override fun detach(resource: NativeJobResource) {
        detached.incrementAndGet()
      }
    }
    val hooks = TrackResourceHooks(delegate)
    val entered = CountDownLatch(1)
    val released = CountDownLatch(1)
    lateinit var resource: NativeJobResource
    resource = NativeJobResource {
      released.countDown()
      hooks.detach(resource)
    }
    val thread = Thread {
      hooks.attach(resource)
      entered.countDown()
      released.await()
    }
    thread.start()
    entered.await()

    hooks.cancelActive()
    requireThreadStopped(thread, 2_000)

    assertEquals(1, attached.get())
    assertEquals(1, detached.get())
    assertFalse(thread.isAlive)
  }
}
