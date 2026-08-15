package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.models.M4aExportPlan
import expo.modules.snapcutmedia.models.M4aPlannedClip
import expo.modules.snapcutmedia.models.M4aSourceSnapshot

internal data class ExportFormatAvailabilityData(
  val format: ExportFormat,
  val mode: String?,
  val available: Boolean,
  val reasons: List<String>,
  val estimatedOutputBytes: Long?,
  val requiredFreeBytes: Long?,
  val sampleRateHz: Int?,
  val channelCount: Int?
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "format" to format.value,
    "mode" to mode,
    "available" to available,
    "reasons" to reasons,
    "estimatedOutputBytes" to estimatedOutputBytes,
    "requiredFreeBytes" to requiredFreeBytes,
    "sampleRateHz" to sampleRateHz,
    "channelCount" to channelCount
  )
}

internal data class ExportPreflightData(
  val preferredFormat: ExportFormat,
  val m4aPlan: M4aExportPlan,
  val formats: List<ExportFormatAvailabilityData>,
  val mayClip: Boolean
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "preferredFormat" to preferredFormat.value,
    "m4aPlan" to m4aPlan.toBridgeMap(),
    "formats" to formats.map { it.toBridgeMap() },
    "mayClip" to mayClip
  )
}

internal data class ExportAudioResultData(
  val format: ExportFormat,
  val mode: String,
  val contentUri: String,
  val displayName: String,
  val requestedDurationMs: Long,
  val actualDurationMs: Long,
  val sampleRateHz: Int,
  val channelCount: Int,
  val bitrateKbps: Int?,
  val bitsPerSample: Int?,
  val maxBoundaryAdjustmentMs: Long,
  val fileSizeBytes: Long
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "format" to format.value,
    "mode" to mode,
    "contentUri" to contentUri,
    "displayName" to displayName,
    "requestedDurationMs" to requestedDurationMs,
    "actualDurationMs" to actualDurationMs,
    "sampleRateHz" to sampleRateHz,
    "channelCount" to channelCount,
    "bitrateKbps" to bitrateKbps,
    "bitsPerSample" to bitsPerSample,
    "maxBoundaryAdjustmentMs" to maxBoundaryAdjustmentMs,
    "fileSizeBytes" to fileSizeBytes
  )
}

internal data class ExportCodecCapabilities(
  val aacAvailable: Boolean,
  val flacAvailable: Boolean,
  val mp3Available: Boolean,
  val resamplerAvailable: Boolean
)

internal enum class ExportStage(val value: String) {
  SCANNING("scanning"),
  VERIFYING_PLAN("verifying_plan"),
  MUXING("muxing"),
  DECODING("decoding"),
  ENCODING("encoding"),
  VERIFYING("verifying"),
  PUBLISHING("publishing"),
  COMPLETE("complete")
}

internal data class ExportProgress(
  val stage: ExportStage,
  val fraction: Double?
)

internal class ExportProgressReporter(
  private val sink: (ExportProgress) -> Unit,
  private val clockMs: () -> Long = { android.os.SystemClock.elapsedRealtime() }
) {
  private var lastStage: ExportStage? = null
  private var lastEmissionMs = Long.MIN_VALUE

  fun report(stage: ExportStage, fraction: Double?, force: Boolean = false) {
    val now = clockMs()
    if (
      !force &&
      stage == lastStage &&
      lastEmissionMs != Long.MIN_VALUE &&
      now - lastEmissionMs < PROGRESS_INTERVAL_MS
    ) {
      return
    }
    lastStage = stage
    lastEmissionMs = now
    sink(ExportProgress(stage, fraction?.takeIf(Double::isFinite)?.coerceIn(0.0, 1.0)))
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 100L
  }
}

internal fun M4aExportPlan.toBridgeMap(): Map<String, Any?> = mapOf(
  "planVersion" to planVersion,
  "planId" to planId,
  "createdAt" to createdAt,
  "eligible" to eligible,
  "reasons" to reasons,
  "codecConfigFingerprint" to codecConfigFingerprint,
  "sampleRateHz" to sampleRateHz,
  "channelCount" to channelCount,
  "maxBoundaryAdjustmentMs" to maxBoundaryAdjustmentMs,
  "estimatedOutputBytes" to estimatedOutputBytes,
  "sourceSnapshots" to sourceSnapshots.map { it.toBridgeMap() },
  "clips" to clips.map { it.toBridgeMap() }
)

private fun M4aSourceSnapshot.toBridgeMap(): Map<String, Any?> = mapOf(
  "sourceId" to sourceId,
  "privateAudioSha256" to privateAudioSha256,
  "codecConfigFingerprint" to codecConfigFingerprint,
  "fileSizeBytes" to fileSizeBytes,
  "lastModifiedEpochMs" to lastModifiedEpochMs
)

private fun M4aPlannedClip.toBridgeMap(): Map<String, Any?> = mapOf(
  "clipId" to clipId,
  "sourceId" to sourceId,
  "requestedStartMs" to requestedStartMs,
  "requestedEndMs" to requestedEndMs,
  "effectiveStartUs" to effectiveStartUs,
  "effectiveEndUs" to effectiveEndUs,
  "startAdjustmentMs" to startAdjustmentMs,
  "endAdjustmentMs" to endAdjustmentMs,
  "estimatedEncodedBytes" to estimatedEncodedBytes
)
