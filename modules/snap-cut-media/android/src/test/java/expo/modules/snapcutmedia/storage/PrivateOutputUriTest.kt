package expo.modules.snapcutmedia.storage

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PrivateOutputUriTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `accepts file URI spellings that canonicalize below a private staging root`() {
    val stagingRoot = temporaryFolder.newFolder("staging")
    val output = File(stagingRoot, ".import-job/source.m4a.partial")
    val singleSlash = output.toURI().toString()
    val tripleSlash = singleSlash.replaceFirst("file:/", "file:///")

    assertEquals(
      output.canonicalFile,
      PrivateOutputUri.requireSafeFileUri(tripleSlash, listOf(stagingRoot))
    )
    assertEquals(
      output.canonicalFile,
      PrivateOutputUri.requireSafeFileUri(singleSlash, listOf(stagingRoot))
    )
  }

  @Test
  fun `accepts missing nested directories below a normal private root`() {
    val stagingRoot = temporaryFolder.newFolder("nested-root")
    val output = File(stagingRoot, ".import-job/missing/nested/source.m4a.partial")

    assertEquals(
      output.canonicalFile,
      PrivateOutputUri.requireSafeFileUri(output.toURI().toString(), listOf(stagingRoot))
    )
  }

  @Test
  fun `rejects root sibling traversal content URI query and fragment`() {
    val stagingRoot = temporaryFolder.newFolder("staging-root")
    val sibling = temporaryFolder.newFolder("staging-root-other")
    val cases = listOf(
      stagingRoot.toURI().toString(),
      File(stagingRoot, "../outside/file.m4a").toURI().toString(),
      File(sibling, "file.m4a").toURI().toString(),
      "content://provider/file.m4a",
      File(stagingRoot, "file.m4a").toURI().toString() + "?token=secret",
      File(stagingRoot, "file.m4a").toURI().toString() + "#fragment"
    )

    cases.forEach { uri ->
      val error = assertThrows(SnapCutMediaException::class.java) {
        PrivateOutputUri.requireSafeFileUri(uri, listOf(stagingRoot))
      }
      assertEquals("PATH_OUTSIDE_PRIVATE_STORAGE", error.code)
    }
  }

  @Test
  fun `rejects source and output canonical aliases before cleanup ownership is registered`() {
    val stagingRoot = temporaryFolder.newFolder("alias-root")
    val output = File(stagingRoot, ".import-job/source.m4a.partial")
    output.parentFile.mkdirs()
    output.writeText("provider source must survive")
    val alias = File(output.parentFile, "../.import-job/${output.name}")

    val error = assertThrows(SnapCutMediaException::class.java) {
      PrivateOutputUri.requireSafeStagingUri(
        output.toURI().toString(),
        listOf(stagingRoot),
        alias.toURI().toString()
      )
    }

    assertEquals("OUTPUT_ALIASES_SOURCE", error.code)
    assertEquals("provider source must survive", output.readText())
  }


  @Test
  fun `rejects an existing symbolic link ancestor even when its target is private`() {
    val stagingRoot = temporaryFolder.newFolder("symlink-root")
    val realDirectory = File(stagingRoot, "real").apply { mkdirs() }
    val symbolicLink = File(stagingRoot, "link")
    val linked = runCatching {
      java.nio.file.Files.createSymbolicLink(symbolicLink.toPath(), realDirectory.toPath())
      true
    }.getOrDefault(false)
    assumeTrue("Symbolic links are unavailable in this test environment", linked)

    val output = File(symbolicLink, "source.m4a.partial")
    val error = assertThrows(SnapCutMediaException::class.java) {
      PrivateOutputUri.requireSafeFileUri(output.toURI().toString(), listOf(stagingRoot))
    }
    assertEquals("PATH_OUTSIDE_PRIVATE_STORAGE", error.code)
  }
}
