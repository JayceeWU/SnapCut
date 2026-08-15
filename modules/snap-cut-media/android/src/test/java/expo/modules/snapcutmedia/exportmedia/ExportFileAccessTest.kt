package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.storage.PrivateOutputUri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ExportFileAccessTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `job output keeps the supplied root spelling and resolves to the created job`() {
    val stagingRoot = temporaryFolder.newFolder("staging")
    val jobDirectory = ExportFileAccess.createJobDirectory(stagingRoot, "job-1")

    val output = ExportFileAccess.createJobOutputFile(
      stagingRoot,
      jobDirectory,
      "composition.mp3"
    )

    assertEquals(File(stagingRoot, ".export-job-1/composition.mp3").path, output.path)
    assertEquals(jobDirectory.canonicalPath, requireNotNull(output.parentFile).canonicalPath)
    assertEquals(
      output.canonicalPath,
      PrivateOutputUri.requireSafeStagingUri(
        output.toURI().toString(),
        listOf(stagingRoot)
      ).canonicalPath
    )
  }

  @Test
  fun `job output rejects a name that can escape its job directory`() {
    val stagingRoot = temporaryFolder.newFolder("staging")
    val jobDirectory = ExportFileAccess.createJobDirectory(stagingRoot, "job-1")

    val error = assertThrows(SnapCutMediaException::class.java) {
      ExportFileAccess.createJobOutputFile(stagingRoot, jobDirectory, "../outside.mp3")
    }

    assertEquals("OUTPUT_WRITE_FAILED", error.code)
  }
}
