package expo.modules.snapcutmedia.exportmedia

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.models.ShareExportRequest

internal class ExportShareService(private val context: Context) {
  fun share(request: ShareExportRequest) {
    val uri = Uri.parse(request.contentUri)
    if (
      uri.scheme != "content" ||
      uri.authority != MediaStore.AUTHORITY ||
      request.contentUri.any(Char::isISOControl)
    ) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    val mimeType = ExportNaming.specification(request.format).mimeType
    val actualMimeType = runCatching { context.contentResolver.getType(uri) }
      .getOrNull()
      ?.lowercase()
    if (actualMimeType != null && actualMimeType != mimeType) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    val sendIntent = Intent(Intent.ACTION_SEND).apply {
      type = mimeType
      putExtra(Intent.EXTRA_STREAM, uri)
      clipData = ClipData.newUri(context.contentResolver, "SnapCut export", uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val chooser = Intent.createChooser(sendIntent, null).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    try {
      context.startActivity(chooser)
    } catch (error: Exception) {
      throw mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE, cause = error)
    }
  }
}
