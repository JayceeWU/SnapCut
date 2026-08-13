package expo.modules.snapcutmedia.codec

import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong

/**
 * Owns one opaque native handle and transfers it to [closeNative] at most once.
 * Native cleanup is also idempotent, but keeping ownership here prevents
 * repeated JNI calls and makes concurrent lifecycle callbacks safe.
 */
internal class NativeCodecHandle(
  handle: Long,
  private val closeNative: (Long) -> Unit
) : Closeable {
  private val ownedHandle = AtomicLong(handle.also { require(it > 0L) })

  val isClosed: Boolean
    get() = ownedHandle.get() == CLOSED_HANDLE

  override fun close() {
    val handle = ownedHandle.getAndSet(CLOSED_HANDLE)
    if (handle != CLOSED_HANDLE) {
      closeNative(handle)
    }
  }

  private companion object {
    const val CLOSED_HANDLE = 0L
  }
}
