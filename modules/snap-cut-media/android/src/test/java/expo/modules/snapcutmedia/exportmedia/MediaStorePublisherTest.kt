package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayOutputStream
import java.io.OutputStream

class MediaStorePublisherTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  @Test
  fun `published row uses collision suffix and leaves no pending row`() {
    val gateway = FakeGateway().apply { names += "Mix.m4a" }
    val source = temporaryFolder.newFile("export.m4a").apply {
      writeBytes(ByteArray(100) { it.toByte() })
    }

    val result = MediaStorePublisher(gateway).publish(
      source,
      "Mix",
      ExportFormat.M4A,
      CancellationCheck.NONE
    )

    assertEquals("Mix (2).m4a", result.displayName)
    assertArrayEquals(source.readBytes(), gateway.bytes.toByteArray())
    assertTrue(gateway.published)
    assertFalse(gateway.deleted)
    assertTrue(gateway.sizeReadWhilePending)
    assertTrue(gateway.nameReadWhilePending)
  }

  @Test
  fun `pending row size mismatch fails before publication and deletes row`() {
    val gateway = FakeGateway().apply { reportedSize = 99L }
    val source = temporaryFolder.newFile("export.m4a").apply { writeBytes(ByteArray(100)) }

    val error = assertThrows(SnapCutMediaException::class.java) {
      MediaStorePublisher(gateway).publish(
        source,
        "Mix",
        ExportFormat.M4A,
        CancellationCheck.NONE
      )
    }

    assertEquals("EXPORT_MEDIASTORE_FAILED", error.code)
    assertFalse(gateway.published)
    assertTrue(gateway.deleted)
    assertTrue(gateway.sizeReadWhilePending)
  }

  @Test
  fun `failure deletes pending row`() {
    val gateway = FakeGateway().apply { failAfterBytes = 10 }
    val source = temporaryFolder.newFile("export.m4a").apply { writeBytes(ByteArray(100)) }

    val error = assertThrows(SnapCutMediaException::class.java) {
      MediaStorePublisher(gateway).publish(
        source,
        "Mix",
        ExportFormat.M4A,
        CancellationCheck.NONE
      )
    }

    assertEquals("EXPORT_MEDIASTORE_FAILED", error.code)
    assertTrue(gateway.deleted)
  }

  @Test
  fun `stale plan detected before publish deletes pending row`() {
    val gateway = FakeGateway()
    val source = temporaryFolder.newFile("export.m4a").apply { writeBytes(ByteArray(100)) }

    val error = assertThrows(SnapCutMediaException::class.java) {
      MediaStorePublisher(gateway).publish(
        source,
        "Mix",
        ExportFormat.M4A,
        CancellationCheck.NONE,
        beforePublish = {
          throw expo.modules.snapcutmedia.errors.mediaError(
            expo.modules.snapcutmedia.errors.SnapCutMediaError.M4A_PLAN_STALE
          )
        }
      )
    }

    assertEquals("M4A_PLAN_STALE", error.code)
    assertFalse(gateway.published)
    assertTrue(gateway.deleted)
  }

  @Test
  fun `invalid inserted URI is deleted without exposing it`() {
    val gateway = FakeGateway().apply { insertedUri = "file:///not-public.m4a" }
    val source = temporaryFolder.newFile("export.m4a").apply { writeBytes(ByteArray(100)) }

    val error = assertThrows(SnapCutMediaException::class.java) {
      MediaStorePublisher(gateway).publish(
        source,
        "Mix",
        ExportFormat.M4A,
        CancellationCheck.NONE
      )
    }

    assertEquals("EXPORT_MEDIASTORE_FAILED", error.code)
    assertTrue(gateway.deleted)
  }

  @Test
  fun `native name validation rejects paths reserved characters and managed extensions`() {
    listOf(".", "..", " Mix", "Mix ", "Mix/Take", "Mix:Take", "Mix.m4a").forEach { name ->
      val error = assertThrows(SnapCutMediaException::class.java) {
        ExportNaming.requireValidBaseName(name)
      }
      assertEquals("INVALID_REQUEST", error.code)
    }
  }

  @Test
  fun `job cancellation closes stream and deletes pending row`() {
    val gateway = FakeGateway()
    var resource: NativeJobResource? = null
    val hooks = object : MediaResourceHooks {
      override fun attach(value: NativeJobResource) {
        resource = value
      }

      override fun detach(value: NativeJobResource) = Unit
    }
    val source = temporaryFolder.newFile("export.m4a").apply { writeBytes(ByteArray(100)) }
    var checks = 0
    val cancellation = CancellationCheck {
      checks++
      if (checks == 2) {
        resource?.cancel()
        throw expo.modules.snapcutmedia.errors.mediaError(
          expo.modules.snapcutmedia.errors.SnapCutMediaError.EXPORT_CANCELLED
        )
      }
    }

    val error = assertThrows(SnapCutMediaException::class.java) {
      MediaStorePublisher(gateway).publish(
        source,
        "Mix",
        ExportFormat.M4A,
        cancellation,
        hooks
      )
    }

    assertEquals("EXPORT_CANCELLED", error.code)
    assertTrue(gateway.deleted)
  }

  @Test
  fun `cancellation before commit cannot publish and cleans pending row`() {
    val gate = ExportCommitGate().apply { begin("export-1", 1L) }
    val gateway = FakeGateway()
    val source = temporaryFolder.newFile("export.m4a").apply { writeBytes(ByteArray(100)) }

    val error = assertThrows(SnapCutMediaException::class.java) {
      MediaStorePublisher(gateway).publish(
        source,
        "Mix",
        ExportFormat.M4A,
        CancellationCheck.NONE,
        beforePublish = {
          assertTrue(gate.requestCancellation("export-1"))
        },
        commitBoundary = gate.boundary("export-1", 1L)
      )
    }

    assertEquals("EXPORT_CANCELLED", error.code)
    assertFalse(gateway.published)
    assertTrue(gateway.deleted)
  }

  @Test
  fun `resource cancellation after commit starts cannot delete public output`() {
    val gateway = FakeGateway()
    val resources = linkedSetOf<NativeJobResource>()
    val hooks = object : MediaResourceHooks {
      override fun attach(value: NativeJobResource) {
        resources += value
      }

      override fun detach(value: NativeJobResource) {
        resources -= value
      }
    }
    gateway.onPublish = { resources.toList().forEach(NativeJobResource::cancel) }
    val source = temporaryFolder.newFile("export.m4a").apply { writeBytes(ByteArray(100)) }

    val result = MediaStorePublisher(gateway).publish(
      source,
      "Mix",
      ExportFormat.M4A,
      CancellationCheck.NONE,
      hooks
    )

    assertEquals("content://media/audio/1", result.contentUri)
    assertTrue(gateway.published)
    assertFalse(gateway.deleted)
  }

  @Test
  fun `publication failure is owner-aborted and deletes pending row`() {
    val gateway = FakeGateway().apply { publishResult = false }
    val source = temporaryFolder.newFile("export.m4a").apply { writeBytes(ByteArray(100)) }

    val error = assertThrows(SnapCutMediaException::class.java) {
      MediaStorePublisher(gateway).publish(
        source,
        "Mix",
        ExportFormat.M4A,
        CancellationCheck.NONE
      )
    }

    assertEquals("EXPORT_MEDIASTORE_FAILED", error.code)
    assertFalse(gateway.published)
    assertTrue(gateway.deleted)
  }

  private class FakeGateway : MediaStoreGateway {
    val names = linkedSetOf<String>()
    val bytes = ByteArrayOutputStream()
    var published = false
    var deleted = false
    var failAfterBytes: Int? = null
    var insertedUri = "content://media/audio/1"
    var reportedSize: Long? = null
    var publishResult = true
    var onPublish: () -> Unit = {}
    var sizeReadWhilePending = false
    var nameReadWhilePending = false
    private var displayName = ""

    override fun existingDisplayNames(): Set<String> = names

    override fun insertPending(displayName: String, mimeType: String): String {
      this.displayName = displayName
      return insertedUri
    }

    override fun openOutput(contentUri: String): OutputStream = object : OutputStream() {
      override fun write(value: Int) {
        failIfNeeded(1)
        bytes.write(value)
      }

      override fun write(buffer: ByteArray, offset: Int, length: Int) {
        failIfNeeded(length)
        bytes.write(buffer, offset, length)
      }

      private fun failIfNeeded(next: Int) {
        val limit = failAfterBytes ?: return
        if (bytes.size() + next > limit) throw IllegalStateException("simulated output failure")
      }
    }

    override fun publish(contentUri: String): Boolean {
      onPublish()
      if (publishResult) published = true
      return publishResult
    }

    override fun readDisplayName(contentUri: String): String {
      nameReadWhilePending = !published
      return displayName
    }

    override fun readSize(contentUri: String): Long {
      sizeReadWhilePending = !published
      return reportedSize ?: bytes.size().toLong()
    }

    override fun delete(contentUri: String) {
      deleted = true
    }
  }
}
