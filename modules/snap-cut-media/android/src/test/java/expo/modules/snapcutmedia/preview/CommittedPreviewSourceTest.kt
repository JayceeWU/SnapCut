package expo.modules.snapcutmedia.preview

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class CommittedPreviewSourceTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `accepts only a committed source owned by the matching source id`() {
    val filesDirectory = temporaryFolder.newFolder("files")
    val source = committedSource(filesDirectory, "project-a", "source-a", "source.m4a")
    val policy = CommittedPreviewSource(filesDirectory)

    assertEquals(
      source.canonicalFile,
      policy.requireCommittedFile(source.toURI().toString(), "source-a")
    )
    assertMissingSource {
      policy.requireCommittedFile(source.toURI().toString(), "different-source")
    }
    assertMissingSource {
      policy.requireCommittedFile(source.toURI().toString(), "../source-a")
    }
  }

  @Test
  fun `rejects staging external provider and tokenized paths`() {
    val filesDirectory = temporaryFolder.newFolder("files")
    val policy = CommittedPreviewSource(filesDirectory)
    val staging = File(filesDirectory, "SnapCut/.import-job/source-a/source.m4a")
      .apply { parentFile.mkdirs(); writeText("staged") }
    val external = temporaryFolder.newFile("source.mp3").apply { writeText("external") }

    listOf(
      staging.toURI().toString(),
      external.toURI().toString(),
      "content://provider/document/source.m4a",
      external.toURI().toString() + "?token=secret",
      external.toURI().toString() + "#fragment"
    ).forEach { uri ->
      assertMissingSource { policy.requireCommittedFile(uri, "source-a") }
    }
  }

  @Test
  fun `requires project and source commit markers plus canonical source filename`() {
    val filesDirectory = temporaryFolder.newFolder("files")
    val projectDirectory = File(filesDirectory, "SnapCut/projects/project-a")
    val sourceDirectory = File(projectDirectory, "sources/source-a").apply { mkdirs() }
    val uncommitted = File(sourceDirectory, "source.flac").apply { writeText("audio") }
    val policy = CommittedPreviewSource(filesDirectory)

    assertMissingSource { policy.requireCommittedFile(uncommitted.toURI().toString(), "source-a") }
    File(projectDirectory, "project.json").writeText("{}")
    assertMissingSource { policy.requireCommittedFile(uncommitted.toURI().toString(), "source-a") }
    File(sourceDirectory, "source.json").writeText("{}")
    assertEquals(
      uncommitted.canonicalFile,
      policy.requireCommittedFile(uncommitted.toURI().toString(), "source-a")
    )
    assertMissingSource {
      policy.requireCommittedFile(
        File(sourceDirectory, "selected-file.flac").apply { writeText("audio") }.toURI().toString(),
        "source-a"
      )
    }
  }

  private fun committedSource(
    filesDirectory: File,
    projectId: String,
    sourceId: String,
    fileName: String
  ): File {
    val projectDirectory = File(filesDirectory, "SnapCut/projects/$projectId").apply { mkdirs() }
    File(projectDirectory, "project.json").writeText("{}")
    val sourceDirectory = File(projectDirectory, "sources/$sourceId").apply { mkdirs() }
    File(sourceDirectory, "source.json").writeText("{}")
    return File(sourceDirectory, fileName).apply { writeText("audio") }
  }

  private fun assertMissingSource(block: () -> Unit) {
    val error = assertThrows(SnapCutMediaException::class.java) { block() }
    assertEquals("MISSING_SOURCE_FILE", error.code)
  }
}
