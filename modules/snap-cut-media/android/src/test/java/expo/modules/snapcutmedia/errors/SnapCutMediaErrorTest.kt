package expo.modules.snapcutmedia.errors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SnapCutMediaErrorTest {
  @Test
  fun `stable codes are unique and messages are safe`() {
    val values = SnapCutMediaError.entries

    assertEquals(values.size, values.map { it.code }.distinct().size)
    values.forEach { error ->
      assertTrue(error.code.matches(Regex("^[A-Z][A-Z0-9_]+$")))
      assertTrue(error.safeMessage.isNotBlank())
      assertFalse(error.safeMessage.contains("Exception"))
      assertFalse(error.safeMessage.contains("/data/"))
    }
  }

  @Test
  fun `revised public codes are present`() {
    val codes = SnapCutMediaError.entries.map { it.code }.toSet()
    assertTrue(
      codes.containsAll(
        setOf(
          "SOURCE_UNREADABLE",
          "SOURCE_TOO_LARGE",
          "UNSUPPORTED_MEDIA",
          "DRM_UNSUPPORTED",
          "M4S_INIT_MISSING",
          "DISK_SPACE_LOW",
          "OUTPUT_WRITE_FAILED",
          "IMPORT_CANCELLED",
          "JOB_ALREADY_RUNNING"
        )
      )
    )
  }
}
