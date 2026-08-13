package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.M4aSourceSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class M4aSnapshotPolicyTest {
  @Test
  fun `size and modification time must match immutable snapshot`() {
    val snapshot = snapshot()
    M4aSnapshotPolicy.requireMetadata(snapshot, 100L, 200L)

    listOf(101L to 200L, 100L to 201L).forEach { (size, modified) ->
      val error = assertThrows(SnapCutMediaException::class.java) {
        M4aSnapshotPolicy.requireMetadata(snapshot, size, modified)
      }
      assertEquals("M4A_PLAN_STALE", error.code)
    }
  }

  @Test
  fun `hash and codec fingerprint must match immutable snapshot`() {
    val snapshot = snapshot()
    M4aSnapshotPolicy.requireContent(snapshot, HASH, FINGERPRINT, FINGERPRINT)

    listOf(
      arrayOf("b".repeat(64), FINGERPRINT, FINGERPRINT),
      arrayOf(HASH, "c".repeat(64), FINGERPRINT),
      arrayOf(HASH, FINGERPRINT, "d".repeat(64))
    ).forEach { values ->
      val error = assertThrows(SnapCutMediaException::class.java) {
        M4aSnapshotPolicy.requireContent(snapshot, values[0], values[1], values[2])
      }
      assertEquals("M4A_PLAN_STALE", error.code)
    }
  }

  private fun snapshot() = M4aSourceSnapshot(
    "11111111-1111-4111-8111-111111111111",
    HASH,
    FINGERPRINT,
    100L,
    200L
  )

  private companion object {
    val HASH = "a".repeat(64)
    val FINGERPRINT = "f".repeat(64)
  }
}
