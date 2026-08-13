package expo.modules.snapcutmedia.storage

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import java.io.File
import java.io.IOException
import java.net.URI
import java.net.URISyntaxException

internal object PrivateOutputUri {
  fun requireSafeStagingUri(
    outputFileUri: String,
    stagingRoots: Collection<File>,
    sourceUri: String? = null
  ): File {
    val output = requireSafeFileUri(outputFileUri, stagingRoots)
    if (sourceUri != null) {
      val sourceScheme = parseSourceUri(sourceUri).scheme
      if (sourceScheme.equals("file", ignoreCase = true)) {
        val source = requireCanonicalFileSource(sourceUri)
        if (output.path == source.path) {
          throw mediaError(SnapCutMediaError.OUTPUT_ALIASES_SOURCE)
        }
      }
    }
    return output
  }

  fun requireSafeFileUri(outputFileUri: String, stagingRoots: Collection<File>): File {
    if (
      outputFileUri.isBlank() ||
      outputFileUri.any(Char::isISOControl) ||
      stagingRoots.isEmpty()
    ) {
      throw mediaError(SnapCutMediaError.PATH_OUTSIDE_PRIVATE_STORAGE)
    }
    val uri = parseFileUri(outputFileUri)
    val path = uri.path ?: throw mediaError(SnapCutMediaError.PATH_OUTSIDE_PRIVATE_STORAGE)
    if (
      !uri.scheme.equals("file", ignoreCase = true) ||
      uri.isOpaque ||
      !(uri.authority.isNullOrEmpty() || uri.authority.equals("localhost", ignoreCase = true)) ||
      !path.startsWith('/') ||
      path.isBlank() ||
      uri.query != null ||
      uri.fragment != null ||
      uri.userInfo != null ||
      path.split('/').any { it == ".." }
    ) {
      throw mediaError(SnapCutMediaError.PATH_OUTSIDE_PRIVATE_STORAGE)
    }

    val rawCandidate = fileFromUri(uri, path)
    val candidate = canonical(rawCandidate)
    val isPrivateChild = stagingRoots.any { root ->
      val canonicalRoot = canonical(root)
      candidate.path != canonicalRoot.path &&
        candidate.path.startsWith(canonicalRoot.path.withTrailingSeparator()) &&
        hasNoSymbolicLinkEscape(rawCandidate, canonicalRoot)
    }
    if (!isPrivateChild) {
      throw mediaError(SnapCutMediaError.PATH_OUTSIDE_PRIVATE_STORAGE)
    }
    return candidate
  }

  private fun requireCanonicalFileSource(sourceUri: String): File {
    val uri = parseFileUri(sourceUri)
    val path = uri.path ?: throw mediaError(SnapCutMediaError.SOURCE_UNREADABLE)
    if (
      !uri.scheme.equals("file", ignoreCase = true) ||
      uri.isOpaque ||
      !(uri.authority.isNullOrEmpty() || uri.authority.equals("localhost", ignoreCase = true)) ||
      uri.query != null ||
      uri.fragment != null
    ) {
      throw mediaError(SnapCutMediaError.SOURCE_UNREADABLE)
    }
    return canonical(fileFromUri(uri, path), SnapCutMediaError.SOURCE_UNREADABLE)
  }

  private fun parseFileUri(value: String): URI = try {
    URI(value)
  } catch (error: URISyntaxException) {
    throw mediaError(SnapCutMediaError.PATH_OUTSIDE_PRIVATE_STORAGE, cause = error)
  }

  private fun parseSourceUri(value: String): URI = try {
    URI(value)
  } catch (error: URISyntaxException) {
    throw mediaError(SnapCutMediaError.SOURCE_UNREADABLE, cause = error)
  }

  private fun fileFromUri(uri: URI, path: String): File = try {
    if (uri.authority.isNullOrEmpty()) File(uri) else File(path)
  } catch (error: IllegalArgumentException) {
    throw mediaError(SnapCutMediaError.PATH_OUTSIDE_PRIVATE_STORAGE, cause = error)
  }

  private fun canonical(
    file: File,
    error: SnapCutMediaError = SnapCutMediaError.PATH_OUTSIDE_PRIVATE_STORAGE
  ): File = try {
    file.canonicalFile
  } catch (cause: IOException) {
    throw mediaError(error, cause = cause)
  }

  private fun hasNoSymbolicLinkEscape(candidate: File, canonicalRoot: File): Boolean {
    var current: File? = candidate.absoluteFile.parentFile
    while (current != null) {
      val canonicalCurrent = canonical(current)
      if (
        current.exists() &&
        current.toPath().toAbsolutePath().normalize() != canonicalCurrent.toPath().toAbsolutePath().normalize()
      ) {
        return false
      }
      if (canonicalCurrent.path == canonicalRoot.path) {
        return true
      }
      current = current.parentFile
    }
    return false
  }

  private fun String.withTrailingSeparator(): String =
    if (endsWith(File.separator)) this else this + File.separator
}
