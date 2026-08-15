package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.models.M4aExportPlan
import expo.modules.snapcutmedia.models.M4aPlannedClip
import expo.modules.snapcutmedia.models.M4aSourceSnapshot
import expo.modules.snapcutmedia.models.NativePreviewClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class M4aPlanRegistryTest {
  @Test
  fun `only exact native-issued plan and ordered clip request is accepted`() {
    val registry = M4aPlanRegistry()
    val plan = plan("11111111-1111-4111-8111-111111111111")
    registry.issue(PROJECT_ID, plan, listOf(clip()))

    registry.requireIssued(PROJECT_ID, plan, listOf(clip()))
    val changed = plan.copy(maxBoundaryAdjustmentMs = 1L)
    val error = assertThrows(SnapCutMediaException::class.java) {
      registry.requireIssued(PROJECT_ID, changed, listOf(clip()))
    }
    assertEquals("M4A_PLAN_STALE", error.code)

    val changedPrivateSource = assertThrows(SnapCutMediaException::class.java) {
      registry.requireIssued(
        PROJECT_ID,
        plan,
        listOf(clip().copy(audioFileUri = "file:///private/replacement/source.m4a"))
      )
    }
    assertEquals("M4A_PLAN_STALE", changedPrivateSource.code)

    val changedProcessing = assertThrows(SnapCutMediaException::class.java) {
      registry.requireIssued(PROJECT_ID, plan, listOf(clip().copy(gain = 0.5)))
    }
    assertEquals("M4A_PLAN_STALE", changedProcessing.code)
  }

  @Test
  fun `new preflight invalidates the previous plan id`() {
    val registry = M4aPlanRegistry()
    val old = plan("11111111-1111-4111-8111-111111111111")
    val current = plan("22222222-2222-4222-8222-222222222222")
    registry.issue(PROJECT_ID, old, listOf(clip()))
    registry.issue(PROJECT_ID, current, listOf(clip()))

    val error = assertThrows(SnapCutMediaException::class.java) {
      registry.requireIssued(PROJECT_ID, old, listOf(clip()))
    }
    assertEquals("M4A_PLAN_STALE", error.code)
    registry.requireIssued(PROJECT_ID, current, listOf(clip()))
  }

  private fun clip() = NativePreviewClip(
    CLIP_ID,
    SOURCE_ID,
    "file:///private/source.m4a",
    0L,
    100L
  )

  private fun plan(id: String) = M4aExportPlan(
    1,
    id,
    "2026-08-12T20:00:00Z",
    true,
    emptyList(),
    HASH,
    48_000,
    2,
    0L,
    70_000L,
    listOf(M4aSourceSnapshot(SOURCE_ID, HASH, HASH, 100L, 1L)),
    listOf(M4aPlannedClip(CLIP_ID, SOURCE_ID, 0L, 100L, 0L, 100_000L, 0L, 0L, 1L))
  )

  private companion object {
    const val PROJECT_ID = "33333333-3333-4333-8333-333333333333"
    const val SOURCE_ID = "44444444-4444-4444-8444-444444444444"
    const val CLIP_ID = "55555555-5555-4555-8555-555555555555"
    val HASH = "a".repeat(64)
  }
}
