package expo.modules.snapcutmedia.preview

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import java.io.File
import java.net.URI

/** Native defense-in-depth: preview never opens staging, provider, or external paths. */
internal class CommittedPreviewSource(private val applicationFilesDirectory: File) {
  private val projectsRoot = File(applicationFilesDirectory, "SnapCut/projects").canonicalFile

  fun requireCommittedFile(fileUri: String, sourceId: String): File {
    if (!SAFE_COMPONENT.matches(sourceId) || sourceId == "." || sourceId == "..") {
      throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE)
    }
    val uri = try {
      URI(fileUri)
    } catch (error: Exception) {
      throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE, cause = error)
    }
    if (uri.scheme != "file" || uri.host?.isNotEmpty() == true || uri.query != null || uri.fragment != null) {
      throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE)
    }

    val candidate = try {
      File(uri).canonicalFile
    } catch (error: Exception) {
      throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE, cause = error)
    }
    val sourceDirectory = candidate.parentFile
    val sourcesDirectory = sourceDirectory?.parentFile
    val projectDirectory = sourcesDirectory?.parentFile
    val insideCommittedSource =
      sourceDirectory != null &&
        sourcesDirectory != null &&
        projectDirectory != null &&
        projectDirectory.parentFile == projectsRoot &&
        sourcesDirectory.name == SOURCES_DIRECTORY_NAME &&
        sourceDirectory.name == sourceId &&
        File(projectDirectory, PROJECT_METADATA_FILE_NAME).isFile &&
        File(sourceDirectory, SOURCE_METADATA_FILE_NAME).isFile
    val validName = SOURCE_FILE_PATTERN.matches(candidate.name)
    if (!insideCommittedSource || !validName || !candidate.isFile) {
      throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE)
    }
    return candidate
  }

  private companion object {
    const val SOURCES_DIRECTORY_NAME = "sources"
    const val PROJECT_METADATA_FILE_NAME = "project.json"
    const val SOURCE_METADATA_FILE_NAME = "source.json"
    val SAFE_COMPONENT = Regex("[A-Za-z0-9][A-Za-z0-9._-]*")
    val SOURCE_FILE_PATTERN = Regex("source\\.(?:m4a|m4s|mp3|flac|wav|aac)", RegexOption.IGNORE_CASE)
  }
}
