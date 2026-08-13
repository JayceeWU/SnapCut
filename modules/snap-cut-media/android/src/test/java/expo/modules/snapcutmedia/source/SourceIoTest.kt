package expo.modules.snapcutmedia.source

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.jobs.NativeJobResource
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream

class SourceIoTest {
  @Test
  fun `bounded copy accepts exact limit and rejects limit plus one`() {
    val exact = ByteArray(10) { it.toByte() }
    val output = ByteArrayOutputStream()

    val copied = BoundedSourceIo.copy(ByteArrayInputStream(exact), output, 10L)

    assertEquals(10L, copied.bytesCopied)
    assertArrayEquals(exact, output.toByteArray())
    val error = assertThrows(SnapCutMediaException::class.java) {
      BoundedSourceIo.copy(ByteArrayInputStream(ByteArray(11)), null, 10L)
    }
    assertEquals("SOURCE_TOO_LARGE", error.code)
  }

  @Test
  fun `ISO fragment without moov is identified without trusting extension`() {
    val probe = ContainerProbe.fromBytes(box("ftyp") + box("moof") + box("mdat"))

    assertTrue(probe.isIsoBmff)
    assertTrue(probe.hasMovieFragmentBox)
    assertTrue(probe.isFragmentMissingInitialization)

    val selfContained = ContainerProbe.fromBytes(box("ftyp") + box("moov") + box("moof"))
    assertFalse(selfContained.isFragmentMissingInitialization)
  }

  @Test
  fun `WAV signature is content based`() {
    val bytes = "RIFF0000WAVEfmt ".toByteArray(Charsets.US_ASCII)
    assertTrue(ContainerProbe.fromBytes(bytes).isWave)
  }

  @Test
  fun `FLAC signature is content based`() {
    val bytes = "fLaC".toByteArray(Charsets.US_ASCII) + ByteArray(16)

    assertTrue(ContainerProbe.fromBytes(bytes).isFlac)
    assertFalse(ContainerProbe.fromBytes("audio/raw".toByteArray()).isFlac)
  }

  @Test
  fun `picker requests single local media including opaque and M4S MIME types`() {
    assertTrue(SourcePicker.MIME_TYPES.contains("application/octet-stream"))
    assertTrue(SourcePicker.MIME_TYPES.contains("video/iso.segment"))
    assertTrue(SourcePicker.MIME_TYPES.contains("audio/*"))
  }

  @Test
  fun `managed provider stream can be closed by job cancellation`() {
    var closed = false
    var attached: NativeJobResource? = null
    var detached = false
    val input = object : InputStream() {
      override fun read(): Int = -1
      override fun close() {
        closed = true
      }
    }
    val hooks = object : MediaResourceHooks {
      override fun attach(resource: NativeJobResource) {
        attached = resource
      }

      override fun detach(resource: NativeJobResource) {
        detached = resource === attached
      }
    }

    ManagedInputStream(input, hooks)
    checkNotNull(attached).cancel()

    assertTrue(closed)
    assertTrue(detached)
  }

  @Test
  fun `extractor resource is registered before a descriptor is acquired`() {
    val events = mutableListOf<String>()
    val hooks = object : MediaResourceHooks {
      override fun attach(resource: NativeJobResource) {
        events += "attached"
      }

      override fun detach(resource: NativeJobResource) {
        events += "detached"
      }
    }
    val resource = ProvisionalExtractorResource(
      hooks,
      { events += "extractor-released" },
      { events += "provider-open-cancelled" }
    )
    val descriptor = Closeable { events += "descriptor-closed" }

    assertEquals(listOf("attached"), events)
    resource.ownDescriptor(descriptor)
    resource.cancel()
    resource.cancel()

    assertEquals(
      listOf(
        "attached",
        "detached",
        "provider-open-cancelled",
        "descriptor-closed",
        "extractor-released"
      ),
      events
    )
  }

  @Test
  fun `descriptor returned after cancellation is immediately closed`() {
    var extractorReleases = 0
    var descriptorCloses = 0
    val resource = ProvisionalExtractorResource(
      MediaResourceHooks.NONE,
      releaseExtractor = { extractorReleases++ }
    )
    resource.cancel()

    assertThrows(IllegalStateException::class.java) {
      resource.ownDescriptor(Closeable { descriptorCloses++ })
    }

    assertEquals(1, extractorReleases)
    assertEquals(1, descriptorCloses)
  }

  private fun box(type: String, payloadSize: Int = 0): ByteArray {
    val size = 8 + payloadSize
    return byteArrayOf(
      (size ushr 24).toByte(),
      (size ushr 16).toByte(),
      (size ushr 8).toByte(),
      size.toByte()
    ) + type.toByteArray(Charsets.US_ASCII) + ByteArray(payloadSize)
  }
}
