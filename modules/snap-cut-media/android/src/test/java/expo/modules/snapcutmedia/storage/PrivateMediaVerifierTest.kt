package expo.modules.snapcutmedia.storage

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PrivateMediaVerifierTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `streams actual private file size and lowercase sha256`() {
    val root = temporaryFolder.newFolder("projects")
    val file = File(root, "source.m4a").apply {
      writeBytes("abc".toByteArray())
    }

    val result = PrivateMediaVerifier(listOf(root)).verify(file.toURI().toString())

    assertEquals(3L, result.fileSizeBytes)
    assertEquals(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      result.sha256
    )
  }

  @Test
  fun `rejects non allowlisted and missing private files with stable errors`() {
    val root = temporaryFolder.newFolder("projects")
    val outside = temporaryFolder.newFile("outside.m4a").apply { writeBytes(byteArrayOf(1)) }
    val verifier = PrivateMediaVerifier(listOf(root))

    val outsideError = assertThrows(SnapCutMediaException::class.java) {
      verifier.verify(outside.toURI().toString())
    }
    val missingError = assertThrows(SnapCutMediaException::class.java) {
      verifier.verify(File(root, "missing.m4a").toURI().toString())
    }

    assertEquals("PATH_OUTSIDE_PRIVATE_STORAGE", outsideError.code)
    assertEquals("MISSING_SOURCE_FILE", missingError.code)
  }

  @Test
  fun `rejects allowlist root and zero byte input with stable errors`() {
    val root = temporaryFolder.newFolder("projects")
    val empty = File(root, "empty.m4a").apply { createNewFile() }
    val verifier = PrivateMediaVerifier(listOf(root))

    val rootError = assertThrows(SnapCutMediaException::class.java) {
      verifier.verify(root.toURI().toString())
    }
    val emptyError = assertThrows(SnapCutMediaException::class.java) {
      verifier.verify(empty.toURI().toString())
    }

    assertEquals("PATH_OUTSIDE_PRIVATE_STORAGE", rootError.code)
    assertEquals("MISSING_SOURCE_FILE", emptyError.code)
  }
}
