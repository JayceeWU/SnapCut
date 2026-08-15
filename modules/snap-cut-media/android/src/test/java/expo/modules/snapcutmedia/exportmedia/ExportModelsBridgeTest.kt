package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.models.M4aExportPlan
import org.junit.Assert.assertEquals
import org.junit.Test

class ExportModelsBridgeTest {
  @Test
  fun `AAC fallback exposes a stable mode and clipping risk`() {
    val availability = ExportFormatAvailabilityData(
      format = ExportFormat.M4A,
      mode = "aac-lossy-encode",
      available = true,
      reasons = emptyList(),
      estimatedOutputBytes = 400_000,
      requiredFreeBytes = 17_600_000,
      sampleRateHz = 48_000,
      channelCount = 2
    )
    val plan = M4aExportPlan(
      planVersion = 1,
      planId = "plan",
      createdAt = "2026-08-13T00:00:00Z",
      eligible = false,
      reasons = listOf("The timeline requires processing."),
      codecConfigFingerprint = null,
      sampleRateHz = null,
      channelCount = null,
      maxBoundaryAdjustmentMs = 0,
      estimatedOutputBytes = null,
      sourceSnapshots = emptyList(),
      clips = emptyList()
    )
    val bridge = ExportPreflightData(
      preferredFormat = ExportFormat.M4A,
      m4aPlan = plan,
      formats = listOf(availability),
      mayClip = true
    ).toBridgeMap()

    assertEquals(setOf("preferredFormat", "m4aPlan", "formats", "mayClip"), bridge.keys)
    assertEquals("aac-lossy-encode", (bridge["formats"] as List<*>).single().let {
      (it as Map<*, *>)["mode"]
    })
    assertEquals(true, bridge["mayClip"])
  }
}
