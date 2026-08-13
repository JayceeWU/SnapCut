package expo.modules.snapcutmedia.exportmedia

import android.content.Context
import expo.modules.snapcutmedia.codec.NativeCodecBridge
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.export.DecodedExportProgress
import expo.modules.snapcutmedia.export.DecodedExportService
import expo.modules.snapcutmedia.models.ExportAudioRequest
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.models.ExportPreflightRequest
import expo.modules.snapcutmedia.models.ShareExportRequest
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.source.SourceInspector
import java.io.Closeable
import java.io.File

/** Native export facade shared by M4A stream-copy and decoded FLAC/MP3 pipelines. */
internal class SnapCutExportServices(
  context: Context,
  sourceInspector: SourceInspector
) : Closeable {
  private val planRegistry = M4aPlanRegistry()
  private val exportCommitGate = ExportCommitGate()
  private val projectRoots = listOf(File(context.filesDir, "SnapCut/projects"))
  private val stagingRoot = File(context.filesDir, "SnapCut/staging")
  private val publisher = MediaStorePublisher(AndroidMediaStoreGateway(context.contentResolver))
  private val decoded = DecodedExportService(projectRoots, listOf(stagingRoot))
  private val preflight = ExportPreflightService(
    sourceInspector,
    projectRoots,
    planRegistry,
    codecCapabilities = {
      val buildInfo = NativeCodecBridge.getBuildInfo()
      ExportPreflightService.conservativeCodecCapabilities(
        bridgeLoaded = buildInfo.bridgeLoaded,
        flacAvailable = buildInfo.flac.available,
        mp3Available = buildInfo.lame.available,
        resamplerAvailable = buildInfo.libsamplerate.available
      )
    }
  )
  private val m4a = M4aExportService(
    projectRoots,
    stagingRoot,
    planRegistry,
    publisher
  )
  private val share = ExportShareService(context)

  fun preflight(
    request: ExportPreflightRequest,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    progressSink: (ExportProgress) -> Unit
  ): Map<String, Any?> = preflight.preflight(
    request,
    cancellation,
    hooks,
    progressSink
  ).toBridgeMap()

  fun export(
    request: ExportAudioRequest,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    progressSink: (ExportProgress) -> Unit
  ): Map<String, Any?> {
    exportCommitGate.begin(request.jobId, request.generation)
    return when (request.format) {
      ExportFormat.M4A -> m4a.export(
        request,
        cancellation,
        hooks,
        progressSink,
        exportCommitGate.boundary(request.jobId, request.generation)
      ).toBridgeMap()
      ExportFormat.FLAC,
      ExportFormat.MP3 -> exportDecoded(
        request,
        cancellation,
        hooks,
        progressSink,
        exportCommitGate.boundary(request.jobId, request.generation)
      ).toBridgeMap()
    }
  }

  fun requestExportCancellation(jobId: String): Boolean =
    exportCommitGate.requestCancellation(jobId)

  fun completeExport(jobId: String, generation: Long) {
    exportCommitGate.complete(jobId, generation)
  }

  fun share(request: ShareExportRequest) = share.share(request)

  override fun close() {
    exportCommitGate.clear()
    planRegistry.clear()
  }

  private fun exportDecoded(
    request: ExportAudioRequest,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    progressSink: (ExportProgress) -> Unit,
    commitBoundary: MediaStoreCommitBoundary
  ): ExportAudioResultData {
    ExportNaming.requireValidBaseName(request.displayNameWithoutExtension)
    val reporter = ExportProgressReporter(progressSink)
    val resolvedClips = ExportFileAccess.resolveClips(request.clips, projectRoots)
    val requestedDurationMs = ExportMath.safeDurationSum(
      resolvedClips.map { it.endMs - it.startMs }
    )
    val estimate = when (request.format) {
      ExportFormat.FLAC -> ExportMath.estimateFlacBytes(
        requestedDurationMs,
        request.outputSampleRateHz ?: throw mediaError(SnapCutMediaError.EXPORT_PREFLIGHT_FAILED),
        request.outputChannelCount ?: throw mediaError(SnapCutMediaError.EXPORT_PREFLIGHT_FAILED)
      )
      ExportFormat.MP3 -> ExportMath.estimateMp3Bytes(requestedDurationMs)
      ExportFormat.M4A -> throw mediaError(SnapCutMediaError.EXPORT_FORMAT_UNAVAILABLE)
    }
    ExportFileAccess.requireFreeSpace(stagingRoot, ExportMath.requiredFreeBytes(estimate))
    var jobDirectory: File? = null
    try {
      cancellation.throwIfCancelled()
      jobDirectory = ExportFileAccess.createJobDirectory(stagingRoot, request.jobId)
      val extension = ExportNaming.specification(request.format).extension
      val stagingFile = File(jobDirectory, "composition$extension")
      val literalOutputFileUri = stagingFile.toURI().toString()
      val staged = decoded.exportToStaging(
        request,
        literalOutputFileUri,
        cancellation,
        hooks
      ) { progress ->
        val bridged = progress.toExportProgress()
        reporter.report(bridged.stage, bridged.fraction)
      }
      val verificationError = when (request.format) {
        ExportFormat.FLAC -> SnapCutMediaError.FLAC_VERIFICATION_FAILED
        ExportFormat.MP3 -> SnapCutMediaError.MP3_VERIFICATION_FAILED
        ExportFormat.M4A -> SnapCutMediaError.EXPORT_FORMAT_UNAVAILABLE
      }
      if (
        staged.format != request.format ||
        staged.outputFileUri != literalOutputFileUri ||
        !stagingFile.isFile ||
        stagingFile.length() != staged.fileSizeBytes ||
        staged.fileSizeBytes <= 0L ||
        staged.requestedDurationMs != requestedDurationMs ||
        staged.actualDurationMs <= 0L ||
        staged.sampleRateHz != request.outputSampleRateHz ||
        staged.channelCount != request.outputChannelCount ||
        (request.format == ExportFormat.FLAC &&
          (staged.bitrateKbps != null || staged.bitsPerSample != 24)) ||
        (request.format == ExportFormat.MP3 &&
          (staged.bitrateKbps != 320 || staged.bitsPerSample != null))
      ) {
        throw mediaError(verificationError)
      }
      reporter.report(ExportStage.PUBLISHING, 0.0, force = true)
      val published = publisher.publish(
        stagingFile,
        request.displayNameWithoutExtension,
        request.format,
        cancellation,
        hooks,
        onProgress = { fraction ->
          reporter.report(ExportStage.PUBLISHING, fraction)
        },
        commitBoundary = commitBoundary
      )
      runCatching(stagingFile::delete)
      reporter.report(ExportStage.COMPLETE, 1.0, force = true)
      return ExportAudioResultData(
        format = staged.format,
        mode = when (staged.format) {
          ExportFormat.FLAC -> "flac-lossless-encode"
          ExportFormat.MP3 -> "mp3-lossy-encode"
          ExportFormat.M4A -> throw mediaError(SnapCutMediaError.EXPORT_FORMAT_UNAVAILABLE)
        },
        contentUri = published.contentUri,
        displayName = published.displayName,
        requestedDurationMs = staged.requestedDurationMs,
        actualDurationMs = staged.actualDurationMs,
        sampleRateHz = staged.sampleRateHz,
        channelCount = staged.channelCount,
        bitrateKbps = staged.bitrateKbps,
        bitsPerSample = staged.bitsPerSample,
        maxBoundaryAdjustmentMs = 0L,
        fileSizeBytes = published.fileSizeBytes
      )
    } finally {
      runCatching { jobDirectory?.deleteRecursively() }
    }
  }

  private fun DecodedExportProgress.toExportProgress(): ExportProgress = ExportProgress(
    stage = when (stage) {
      "scanning" -> ExportStage.SCANNING
      "decoding" -> ExportStage.DECODING
      "encoding" -> ExportStage.ENCODING
      "verifying" -> ExportStage.VERIFYING
      "complete" -> ExportStage.VERIFYING
      else -> throw mediaError(SnapCutMediaError.UNKNOWN_NATIVE_ERROR)
    },
    fraction = fraction
  )
}
