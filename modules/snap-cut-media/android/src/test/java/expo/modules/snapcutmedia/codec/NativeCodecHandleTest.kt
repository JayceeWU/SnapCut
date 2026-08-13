package expo.modules.snapcutmedia.codec

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCodecHandleTest {
  @Test
  fun `close transfers ownership exactly once`() {
    val closedHandle = AtomicInteger()
    val handle = NativeCodecHandle(42L) { nativeHandle ->
      assertEquals(42L, nativeHandle)
      closedHandle.incrementAndGet()
    }

    assertFalse(handle.isClosed)
    handle.close()
    handle.close()

    assertTrue(handle.isClosed)
    assertEquals(1, closedHandle.get())
  }

  @Test
  fun `concurrent close remains idempotent`() {
    val closeCalls = AtomicInteger()
    val handle = NativeCodecHandle(99L) { closeCalls.incrementAndGet() }
    val start = CountDownLatch(1)
    val executor = Executors.newFixedThreadPool(8)

    try {
      val futures = (1..32).map {
        executor.submit {
          start.await()
          handle.close()
        }
      }
      start.countDown()
      futures.forEach { it.get(5, TimeUnit.SECONDS) }
    } finally {
      executor.shutdownNow()
    }

    assertEquals(1, closeCalls.get())
    assertTrue(handle.isClosed)
  }

  @Test
  fun `zero and negative handles are rejected`() {
    assertThrows(IllegalArgumentException::class.java) { NativeCodecHandle(0L) {} }
    assertThrows(IllegalArgumentException::class.java) { NativeCodecHandle(-1L) {} }
  }

  @Test
  fun `native close status has a stable unknown fallback`() {
    assertEquals(NativeHandleCloseResult.CLOSED, NativeHandleCloseResult.fromNativeCode(0))
    assertEquals(
      NativeHandleCloseResult.ALREADY_CLOSED_OR_UNKNOWN,
      NativeHandleCloseResult.fromNativeCode(1)
    )
    assertEquals(
      NativeHandleCloseResult.ALREADY_CLOSED_OR_UNKNOWN,
      NativeHandleCloseResult.fromNativeCode(999)
    )
  }
}
