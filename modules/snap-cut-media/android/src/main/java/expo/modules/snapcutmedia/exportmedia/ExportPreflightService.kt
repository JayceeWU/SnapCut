package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.models.ExportPreflightRequest
import expo.modules.snapcutmedia.models.M4aExportPlan
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.source.SourceInspector
import expo.modules.snapcutmedia.source.SourceSizePolicy
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlin.math.abs

internal class ExportPreflightService(
  private val sourceInspector: SourceInspector,
  private val projectRoots: Collection<File>,
  private val planRegistry: M4aPlanRegistry,
  private val m4aScanner: M4aSourceScanner = M4aSourceScanner(),
  private val codecCapabilities: () -> ExportCodecCapabilities,
  private val planIdFactory: () -> String = { UUID.randomUUID().toString() },
  private val now: () -> String = { Instant.now().toString() }
) {
  fun preflight(
    request: ExportPreflightRequest,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE,
    progressSink: (ExportProgress) -> Unit = {}
  ): ExportPreflightData {
    if (request.jobId.isBlank() || request.projectId.isBlank() || request.generation < 0L) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    planRegistry.invalidate(request.projectId)
    val reporter = ExportProgressReporter(progressSink)
    reporter.report(ExportStage.SCANNING, 0.0, force = true)
    cancellation.throwIfCancelled()
    val clips = ExportFileAccess.resolveClips(request.clips, projectRoots)
    val sources = clips.groupBy(ResolvedExportClip::sourceId)
    val inspections = linkedMapOf<String, expo.modules.snapcutmedia.models.SourceInspection>()
    sources.entries.forEachIndexed { index, (sourceId, sourceClips) ->
      cancellation.throwIfCancelled()
      val file = sourceClips.first().file
      val inspection = sourceInspector.inspect(
        file.toURI().toString(),
        SourceSizePolicy.MAX_SOURCE_BYTES,
        cancellation,
        hooks
      )
      if (sourceClips.any { it.endMs > inspection.durationMs }) {
        throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
      }
      inspections[sourceId] = inspection
      reporter.report(
        ExportStage.SCANNING,
        (index + 1).toDouble() / (sources.size * 2.0)
      )
    }

    val sourcePlans = linkedMapOf<String, M4aSourcePlan>()
    val m4aReasons = linkedSetOf<String>()
    sources.entries.forEachIndexed { index, (sourceId, sourceClips) ->
      cancellation.throwIfCancelled()
      try {
        m4aScanner.requirePrivateM4aSource(sourceClips.first().file)
        sourcePlans[sourceId] = m4aScanner.scan(
          sourceId,
          sourceClips.first().file,
          sourceClips,
          cancellation,
          hooks
        )
      } catch (error: M4aIneligibleException) {
        m4aReasons += error.safeReason
      } catch (error: SnapCutMediaException) {
        if (error.error == SnapCutMediaError.EXPORT_CANCELLED) throw error
        m4aReasons += M4A_SCAN_REASON
      } catch (_: Exception) {
        cancellation.throwIfCancelled()
        m4aReasons += M4A_SCAN_REASON
      }
      reporter.report(
        ExportStage.SCANNING,
        0.5 + (index + 1).toDouble() / (sources.size * 2.0)
      )
    }

    if (sourcePlans.size == sources.size) {
      val fingerprints = sourcePlans.values.map(M4aSourcePlan::codecConfigFingerprint).distinct()
      val sampleRates = sourcePlans.values.map(M4aSourcePlan::sampleRateHz).distinct()
      val channelCounts = sourcePlans.values.map(M4aSourcePlan::channelCount).distinct()
      if (fingerprints.size != 1) m4aReasons += CONFIG_REASON
      if (sampleRates.size != 1 || channelCounts.size != 1) m4aReasons += LAYOUT_REASON
    }

    val m4aPlan = buildM4aPlan(request, sourcePlans, m4aReasons)
    val requestedDurationMs = ExportMath.safeDurationSum(clips.map { it.endMs - it.startMs })
    val outputRate = ExportMath.outputSampleRate(inspections.values.map { it.sampleRateHz })
    val outputChannels = ExportMath.outputChannelCount(inspections.values.map { it.channelCount })
    val flacEstimate = ExportMath.estimateFlacBytes(requestedDurationMs, outputRate, outputChannels)
    val mp3Estimate = ExportMath.estimateMp3Bytes(requestedDurationMs)
    val capabilities = codecCapabilities()
    val needsResampling = inspections.values.any { it.sampleRateHz != outputRate }
    val flacReasons = buildList {
      if (!capabilities.flacAvailable) add("The FLAC encoder is unavailable in this build.")
      if (needsResampling && !capabilities.resamplerAvailable) {
        add("Sample-rate conversion is unavailable in this build.")
      }
    }
    val mp3Reasons = buildList {
      if (!capabilities.mp3Available) add("The MP3 encoder is unavailable in this build.")
      if (needsResampling && !capabilities.resamplerAvailable) {
        add("Sample-rate conversion is unavailable in this build.")
      }
    }
    val formats = listOf(
      ExportFormatAvailabilityData(
        ExportFormat.M4A,
        m4aPlan.eligible,
        m4aPlan.reasons,
        m4aPlan.estimatedOutputBytes,
        m4aPlan.estimatedOutputBytes?.let(ExportMath::requiredFreeBytes),
        m4aPlan.sampleRateHz,
        m4aPlan.channelCount
      ),
      ExportFormatAvailabilityData(
        ExportFormat.FLAC,
        flacReasons.isEmpty(),
        flacReasons,
        flacEstimate,
        ExportMath.requiredFreeBytes(flacEstimate),
        outputRate,
        outputChannels
      ),
      ExportFormatAvailabilityData(
        ExportFormat.MP3,
        mp3Reasons.isEmpty(),
        mp3Reasons,
        mp3Estimate,
        ExportMath.requiredFreeBytes(mp3Estimate),
        outputRate,
        outputChannels
      )
    )
    val result = ExportPreflightData(
      preferredFormat = if (m4aPlan.eligible) ExportFormat.M4A else ExportFormat.FLAC,
      m4aPlan = m4aPlan,
      formats = formats
    )
    cancellation.throwIfCancelled()
    if (m4aPlan.eligible) {
      planRegistry.issue(request.projectId, m4aPlan, request.clips)
    }
    reporter.report(ExportStage.COMPLETE, 1.0, force = true)
    return result
  }

  companion object {
    fun conservativeCodecCapabilities(
      bridgeLoaded: Boolean,
      flacAvailable: Boolean,
      mp3Available: Boolean,
      resamplerAvailable: Boolean
    ): ExportCodecCapabilities = ExportCodecCapabilities(
      flacAvailable = bridgeLoaded && flacAvailable,
      mp3Available = bridgeLoaded && mp3Available,
      resamplerAvailable = bridgeLoaded && resamplerAvailable
    )

    private const val PLAN_VERSION = 1
    private const val M4A_SCAN_REASON =
      "A selected source cannot be safely scanned for M4A stream copy."
    private const val CONFIG_REASON =
      "AAC codec configurations differ between selected sources."
    private const val LAYOUT_REASON =
      "AAC sample rates or channel counts differ between selected sources."
  }

  private fun buildM4aPlan(
    request: ExportPreflightRequest,
    sourcePlans: Map<String, M4aSourcePlan>,
    reasons: Set<String>
  ): M4aExportPlan {
    val eligible = reasons.isEmpty() && sourcePlans.isNotEmpty()
    if (!eligible) {
      return M4aExportPlan(
        planVersion = PLAN_VERSION,
        planId = planIdFactory(),
        createdAt = now(),
        eligible = false,
        reasons = reasons.ifEmpty { setOf(M4A_SCAN_REASON) }.toList(),
        codecConfigFingerprint = null,
        sampleRateHz = null,
        channelCount = null,
        maxBoundaryAdjustmentMs = 0L,
        estimatedOutputBytes = null,
        sourceSnapshots = emptyList(),
        clips = emptyList()
      )
    }
    val plannedByClip = sourcePlans.values
      .flatMap(M4aSourcePlan::plannedClips)
      .associateBy { it.clipId }
    val plannedClips = request.clips.map { clip ->
      plannedByClip[clip.clipId] ?: throw mediaError(SnapCutMediaError.EXPORT_PREFLIGHT_FAILED)
    }
    val payloadBytes = plannedClips.fold(0L) { total, clip ->
      try {
        Math.addExact(total, clip.estimatedEncodedBytes)
      } catch (_: ArithmeticException) {
        throw mediaError(SnapCutMediaError.EXPORT_PREFLIGHT_FAILED)
      }
    }
    val first = sourcePlans.values.first()
    return M4aExportPlan(
      planVersion = PLAN_VERSION,
      planId = planIdFactory(),
      createdAt = now(),
      eligible = true,
      reasons = emptyList(),
      codecConfigFingerprint = first.codecConfigFingerprint,
      sampleRateHz = first.sampleRateHz,
      channelCount = first.channelCount,
      maxBoundaryAdjustmentMs = plannedClips.maxOf { clip ->
        maxOf(abs(clip.startAdjustmentMs), abs(clip.endAdjustmentMs))
      },
      estimatedOutputBytes = ExportMath.estimateM4aBytes(payloadBytes),
      sourceSnapshots = sourcePlans.values.map(M4aSourcePlan::snapshot),
      clips = plannedClips
    )
  }

}
