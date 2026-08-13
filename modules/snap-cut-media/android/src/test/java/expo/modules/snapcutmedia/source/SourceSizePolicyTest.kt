package expo.modules.snapcutmedia.source

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SourceSizePolicyTest {
  @Test
  fun `null zero and negative provider sizes remain unknown`() {
    assertNull(SourceSizePolicy.normalizeReportedSize(null))
    assertNull(SourceSizePolicy.normalizeReportedSize(0L))
    assertNull(SourceSizePolicy.normalizeReportedSize(-1L))
    assertEquals(1L, SourceSizePolicy.normalizeReportedSize(1L))
  }

  @Test
  fun `largest positive candidate wins and disagreement requires a streaming count`() {
    val result = SourceSizePolicy.resolveReportedSizes(10L, 20L, 15L)

    assertEquals(20L, result.reportedSizeBytes)
    assertTrue(result.candidatesDisagree)
    assertTrue(result.requiresStreamingVerification)
  }

  @Test
  fun `matching candidates avoid a redundant streaming size count`() {
    val result = SourceSizePolicy.resolveReportedSizes(42L, 42L, -1L)

    assertEquals(42L, result.reportedSizeBytes)
    assertFalse(result.candidatesDisagree)
    assertFalse(result.requiresStreamingVerification)
  }

  @Test
  fun `all unknown candidates require limit plus one streaming verification`() {
    val result = SourceSizePolicy.resolveReportedSizes(null, 0L, -1L)

    assertNull(result.reportedSizeBytes)
    assertTrue(result.requiresStreamingVerification)
    assertEquals(
      SourceSizePolicy.MAX_SOURCE_BYTES + 1L,
      SourceSizePolicy.boundedReadByteCount(Long.MAX_VALUE)
    )
    assertEquals(64 * 1024, SourceSizePolicy.STREAM_BUFFER_BYTES)
  }

  @Test
  fun `exactly 600 MiB is accepted and one extra byte is rejected`() {
    SourceSizePolicy.requireReportedSizeWithinLimit(
      SourceSizePolicy.MAX_SOURCE_BYTES,
      SourceSizePolicy.MAX_SOURCE_BYTES
    )
    SourceSizePolicy.requireStreamedSizeWithinLimit(
      SourceSizePolicy.MAX_SOURCE_BYTES,
      SourceSizePolicy.MAX_SOURCE_BYTES
    )

    val reportedError = assertThrows(SnapCutMediaException::class.java) {
      SourceSizePolicy.requireReportedSizeWithinLimit(
        SourceSizePolicy.MAX_SOURCE_BYTES + 1L,
        Long.MAX_VALUE
      )
    }
    val streamedError = assertThrows(SnapCutMediaException::class.java) {
      SourceSizePolicy.requireStreamedSizeWithinLimit(
        SourceSizePolicy.MAX_SOURCE_BYTES + 1L,
        Long.MAX_VALUE
      )
    }

    assertEquals("SOURCE_TOO_LARGE", reportedError.code)
    assertEquals("SOURCE_TOO_LARGE", streamedError.code)
  }

  @Test
  fun `JavaScript cannot raise the native hard limit but may lower it`() {
    assertEquals(SourceSizePolicy.MAX_SOURCE_BYTES, SourceSizePolicy.effectiveLimit(Long.MAX_VALUE))
    assertEquals(100L, SourceSizePolicy.effectiveLimit(100L))

    val error = assertThrows(SnapCutMediaException::class.java) {
      SourceSizePolicy.requireReportedSizeWithinLimit(101L, 100L)
    }
    assertEquals("SOURCE_TOO_LARGE", error.code)
  }
}
