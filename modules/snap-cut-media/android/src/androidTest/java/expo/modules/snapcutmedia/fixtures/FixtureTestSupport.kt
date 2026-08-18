package expo.modules.snapcutmedia.fixtures

import android.content.Context
import android.net.Uri
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.source.MediaResourceHooks
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

internal object FixtureUris {
  const val AUTHORITY = "expo.modules.snapcutmedia.test.fixtures"

  fun build(path: String, vararg parameters: Pair<String, String>): Uri = Uri.Builder()
    .scheme("content")
    .authority(AUTHORITY)
    .appendPath(path)
    .apply { parameters.forEach { (key, value) -> appendQueryParameter(key, value) } }
    .build()
}

internal class TrackingResourceHooks : MediaResourceHooks {
  private val lock = Object()
  private val resources = linkedSetOf<NativeJobResource>()
  private val firstAttachment = CountDownLatch(1)
  val attachmentCount = AtomicInteger(0)
  val detachmentCount = AtomicInteger(0)

  override fun attach(resource: NativeJobResource) {
    synchronized(lock) {
      resources += resource
      attachmentCount.incrementAndGet()
      firstAttachment.countDown()
      lock.notifyAll()
    }
  }

  override fun detach(resource: NativeJobResource) {
    synchronized(lock) {
      if (resources.remove(resource)) detachmentCount.incrementAndGet()
      lock.notifyAll()
    }
  }

  fun awaitAttachment(timeoutSeconds: Long = 5L): Boolean =
    firstAttachment.await(timeoutSeconds, TimeUnit.SECONDS)

  fun cancelAttached() {
    val snapshot = synchronized(lock) { resources.toList() }
    snapshot.forEach(NativeJobResource::cancel)
  }

  fun awaitIdle(timeoutSeconds: Long = 5L): Boolean {
    val deadlineNanos = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
    synchronized(lock) {
      while (resources.isNotEmpty()) {
        val remainingNanos = deadlineNanos - System.nanoTime()
        if (remainingNanos <= 0L) return false
        TimeUnit.NANOSECONDS.timedWait(lock, remainingNanos)
      }
      return true
    }
  }

  fun isIdle(): Boolean = synchronized(lock) { resources.isEmpty() }
}

internal fun freshFixtureDirectory(context: Context, name: String): File {
  val testRoot = File(context.cacheDir, "snapcut-connected-tests")
  val directory = File(testRoot, name)
  directory.deleteRecursively()
  check(directory.mkdirs())
  return directory
}
