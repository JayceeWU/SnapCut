package expo.modules.snapcutmedia.source

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.PickedSource
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.FileNotFoundException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal class SourcePicker(private val resolver: ContentResolver) {
  private var pending: CancellableContinuation<PickedSource?>? = null

  suspend fun pick(activity: Activity): PickedSource? = suspendCancellableCoroutine { continuation ->
    synchronized(this) {
      if (pending != null) {
        continuation.resumeWithException(mediaError(SnapCutMediaError.JOB_ALREADY_RUNNING))
        return@suspendCancellableCoroutine
      }
      pending = continuation
    }
    continuation.invokeOnCancellation {
      synchronized(this) {
        if (pending === continuation) pending = null
      }
    }
    try {
      activity.startActivityForResult(createIntent(), REQUEST_CODE)
    } catch (error: Exception) {
      synchronized(this) {
        if (pending === continuation) pending = null
      }
      continuation.resumeWithException(
        mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE, cause = error)
      )
    }
  }

  fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
    if (requestCode != REQUEST_CODE) return false
    val continuation = synchronized(this) {
      pending.also { pending = null }
    } ?: return true
    if (!continuation.isActive) return true
    if (resultCode != Activity.RESULT_OK) {
      continuation.resume(null)
      return true
    }
    val uri = data?.data
    if (uri == null) {
      continuation.resumeWithException(mediaError(SnapCutMediaError.SOURCE_NOT_FOUND))
      return true
    }
    try {
      continuation.resume(readHints(uri))
    } catch (error: SecurityException) {
      continuation.resumeWithException(
        // Provider exception messages commonly contain the full opaque URI.
        // Do not retain them as bridge causes or diagnostics.
        mediaError(SnapCutMediaError.SOURCE_PERMISSION_DENIED)
      )
    } catch (error: FileNotFoundException) {
      continuation.resumeWithException(mediaError(SnapCutMediaError.SOURCE_NOT_FOUND))
    } catch (error: Exception) {
      continuation.resumeWithException(mediaError(SnapCutMediaError.SOURCE_UNREADABLE))
    }
    return true
  }

  fun cancelPending() {
    val continuation = synchronized(this) {
      pending.also { pending = null }
    }
    continuation?.cancel()
  }

  private fun readHints(uri: Uri): PickedSource {
    var name: String? = null
    var size: Long? = null
    // Name, MIME, and picker size are hints only. A provider that cannot
    // answer metadata queries must still be importable through the opaque URI.
    runCatching {
      resolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            .takeIf { it >= 0 && !cursor.isNull(it) }
            ?.let { name = cursor.getString(it)?.takeIf(String::isNotBlank) }
          cursor.getColumnIndex(OpenableColumns.SIZE)
            .takeIf { it >= 0 && !cursor.isNull(it) }
            ?.let { size = SourceSizePolicy.normalizeReportedSize(cursor.getLong(it)) }
        }
      }
    }
    return PickedSource(
      sourceUri = uri.toString(),
      suggestedName = name,
      suggestedMimeType = runCatching { resolver.getType(uri) }
        .getOrNull()
        ?.takeIf(String::isNotBlank),
      suggestedSizeBytes = size
    )
  }

  companion object {
    const val REQUEST_CODE = 0x5343
    val MIME_TYPES = arrayOf(
      "audio/*",
      "video/*",
      "application/mp4",
      "application/octet-stream",
      "video/iso.segment"
    )

    fun createIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_MIME_TYPES, MIME_TYPES)
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
      putExtra(Intent.EXTRA_LOCAL_ONLY, true)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      // Deliberately omit takePersistableUriPermission: the URI is transient.
    }
  }
}
