package expo.modules.snapcutmedia.storage

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.PrivateMediaVerificationResult
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/** Reads only allowlisted app-private media; no expected value crosses this boundary. */
internal class PrivateMediaVerifier(
  private val allowedRoots: Collection<File>
) {
  init {
    require(allowedRoots.isNotEmpty())
  }

  fun verify(fileUri: String): PrivateMediaVerificationResult {
    val file = PrivateOutputUri.requireSafeFileUri(fileUri, allowedRoots)
    if (!file.isFile) throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE)
    val sizeBefore = file.length()
    val modifiedBefore = file.lastModified()
    if (sizeBefore <= 0L) throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE)
    val digest = MessageDigest.getInstance("SHA-256")
    var bytesRead = 0L
    try {
      FileInputStream(file).use { input ->
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          if (read == 0) continue
          digest.update(buffer, 0, read)
          bytesRead = Math.addExact(bytesRead, read.toLong())
        }
      }
    } catch (error: Exception) {
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.IMPORT_VERIFICATION_FAILED, cause = error)
    }
    if (
      bytesRead <= 0L ||
      bytesRead != sizeBefore ||
      file.length() != sizeBefore ||
      file.lastModified() != modifiedBefore
    ) {
      throw mediaError(SnapCutMediaError.IMPORT_VERIFICATION_FAILED)
    }
    return PrivateMediaVerificationResult(
      fileSizeBytes = bytesRead,
      sha256 = digest.digest().joinToString("") { "%02x".format(it) }
    )
  }

  private companion object {
    const val BUFFER_BYTES = 64 * 1024
  }
}
