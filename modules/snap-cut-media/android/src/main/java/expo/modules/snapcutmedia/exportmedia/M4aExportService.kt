package expo.modules.snapcutmedia.exportmedia

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaMuxer
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.ExportAudioRequest
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.models.M4aExportPlan
import expo.modules.snapcutmedia.models.M4aPlannedClip
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import java.io.File

internal class M4aExportService(
  private val projectRoots: Collection<File>,
  private val stagingRoot: File,
  private val planRegistry: M4aPlanRegistry,
  private val publisher: MediaStorePublisher,
  private val scanner: M4aSourceScanner = M4aSourceScanner(),
  private val verifier: M4aOutputVerifier = M4aOutputVerifier(scanner)
) {
  fun export(
    request: ExportAudioRequest,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE,
    progressSink: (ExportProgress) -> Unit = {},
    commitBoundary: MediaStoreCommitBoundary = MediaStoreCommitBoundary.DIRECT
  ): ExportAudioResultData {
    val plan = requireValidRequest(request)
    planRegistry.requireIssued(request.projectId, plan, request.clips)
    val clips = ExportFileAccess.resolveClips(request.clips, projectRoots)
    val requestedDurationMs = ExportMath.safeDurationSum(
      clips.map { it.endMs - it.startMs }
    )
    val resolvedByClip = clips.associateBy(ResolvedExportClip::clipId)
    val filesBySource = clips.associate { it.sourceId to it.file }
    val fingerprint = plan.codecConfigFingerprint
      ?: throw mediaError(SnapCutMediaError.M4A_NOT_ELIGIBLE)
    val sampleRate = plan.sampleRateHz
      ?: throw mediaError(SnapCutMediaError.M4A_NOT_ELIGIBLE)
    val channelCount = plan.channelCount
      ?: throw mediaError(SnapCutMediaError.M4A_NOT_ELIGIBLE)
    val estimatedOutputBytes = plan.estimatedOutputBytes
      ?: throw mediaError(SnapCutMediaError.M4A_NOT_ELIGIBLE)
    val reporter = ExportProgressReporter(progressSink)
    var jobDirectory: File? = null
    try {
      reporter.report(ExportStage.VERIFYING_PLAN, 0.0, force = true)
      cancellation.throwIfCancelled()
      val metadataBySource = validateSnapshots(
        plan,
        filesBySource,
        fingerprint,
        sampleRate,
        channelCount,
        cancellation,
        hooks
      )
      reporter.report(ExportStage.VERIFYING_PLAN, 1.0, force = true)
      ExportFileAccess.requireFreeSpace(
        stagingRoot,
        ExportMath.requiredFreeBytes(estimatedOutputBytes)
      )
      jobDirectory = ExportFileAccess.createJobDirectory(stagingRoot, request.jobId)
      val stagingFile = File(jobDirectory, STAGING_FILE_NAME)
      reporter.report(ExportStage.MUXING, 0.0, force = true)
      val muxed = mux(
        stagingFile,
        plan,
        resolvedByClip,
        metadataBySource,
        cancellation,
        hooks,
        reporter
      )
      reporter.report(ExportStage.VERIFYING, null, force = true)
      val verified = verifier.verify(
        stagingFile,
        fingerprint,
        sampleRate,
        channelCount,
        muxed.durationUs,
        muxed.payloadProof,
        muxed.timelineProof,
        cancellation,
        hooks
      )
      // Re-read source fingerprints after muxing to reject an in-flight source mutation.
      validateSnapshots(
        plan,
        filesBySource,
        fingerprint,
        sampleRate,
        channelCount,
        cancellation,
        hooks
      )
      reporter.report(ExportStage.PUBLISHING, 0.0, force = true)
      val published = publisher.publish(
        stagingFile,
        request.displayNameWithoutExtension,
        ExportFormat.M4A,
        cancellation,
        hooks,
        onProgress = { fraction -> reporter.report(ExportStage.PUBLISHING, fraction) },
        beforePublish = {
          validateSnapshots(
            plan,
            filesBySource,
            fingerprint,
            sampleRate,
            channelCount,
            cancellation,
            hooks
          )
        },
        commitBoundary = commitBoundary
      )
      runCatching(stagingFile::delete)
      reporter.report(ExportStage.COMPLETE, 1.0, force = true)
      return ExportAudioResultData(
        format = ExportFormat.M4A,
        mode = "aac-stream-copy",
        contentUri = published.contentUri,
        displayName = published.displayName,
        requestedDurationMs = requestedDurationMs,
        actualDurationMs = (verified.durationUs + 500L) / 1000L,
        sampleRateHz = sampleRate,
        channelCount = channelCount,
        bitrateKbps = null,
        maxBoundaryAdjustmentMs = plan.maxBoundaryAdjustmentMs,
        fileSizeBytes = published.fileSizeBytes
      )
    } finally {
      runCatching { jobDirectory?.deleteRecursively() }
    }
  }

  private fun requireValidRequest(request: ExportAudioRequest): M4aExportPlan {
    ExportNaming.requireValidBaseName(request.displayNameWithoutExtension)
    val plan = request.m4aPlan
    if (
      request.jobId.isBlank() ||
      request.projectId.isBlank() ||
      request.generation < 0L ||
      request.format != ExportFormat.M4A ||
      request.outputSampleRateHz != null ||
      request.outputChannelCount != null ||
      plan == null ||
      plan.planVersion != PLAN_VERSION ||
      !plan.eligible ||
      plan.planId.isBlank()
    ) {
      throw mediaError(SnapCutMediaError.M4A_NOT_ELIGIBLE)
    }
    return plan
  }

  private fun validateSnapshots(
    plan: M4aExportPlan,
    filesBySource: Map<String, File>,
    fingerprint: String,
    sampleRate: Int,
    channelCount: Int,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): Map<String, M4aTrackMetadata> {
    if (plan.sourceSnapshots.size != filesBySource.size) {
      throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
    }
    return plan.sourceSnapshots.associate { snapshot ->
      val file = filesBySource[snapshot.sourceId]
        ?: throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
      try {
        scanner.requirePrivateM4aSource(file)
      } catch (_: M4aIneligibleException) {
        throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
      }
      val metadata = scanner.requireCurrentSnapshot(
        file,
        snapshot,
        fingerprint,
        cancellation,
        hooks
      )
      if (metadata.sampleRateHz != sampleRate || metadata.channelCount != channelCount) {
        throw mediaError(SnapCutMediaError.M4A_INCOMPATIBLE_CODEC_CONFIG)
      }
      snapshot.sourceId to metadata
    }
  }

  private fun mux(
    output: File,
    plan: M4aExportPlan,
    clipsById: Map<String, ResolvedExportClip>,
    metadataBySource: Map<String, M4aTrackMetadata>,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    reporter: ExportProgressReporter
  ): MuxedM4a {
    val payloadTarget = plan.clips.fold(0L) { total, clip ->
      Math.addExact(total, clip.estimatedEncodedBytes)
    }
    val firstMetadata = plan.clips.firstOrNull()?.sourceId?.let(metadataBySource::get)
      ?: throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
    val muxer = try {
      MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    } catch (error: Exception) {
      throw mediaError(SnapCutMediaError.M4A_MUX_FAILED, cause = error)
    }
    val resource = ExportMuxerResource(muxer, hooks)
    try {
      val outputTrack = muxer.addTrack(firstMetadata.format)
      muxer.start()
      resource.markStarted()
      val adaptive = AdaptiveEncodedBuffer()
      val payloadProof = EncodedStreamProofAccumulator()
      val timelineWriter = M4aTimelineProofWriter(
        File(output.parentFile, TIMELINE_PROOF_FILE_NAME)
      )
      var outputBaseUs = 0L
      var payloadCopied = 0L
      var lastOutputTimestampUs = -1L
      val timelineProof = timelineWriter.use { timeline ->
        plan.clips.forEach { planned ->
          cancellation.throwIfCancelled()
          val resolved = clipsById[planned.clipId]
            ?: throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
          if (resolved.sourceId != planned.sourceId) {
            throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
          }
          val metadata = metadataBySource[planned.sourceId]
            ?: throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
          val copied = copyClip(
            resolved.file,
            metadata,
            planned,
            muxer,
            outputTrack,
            outputBaseUs,
            lastOutputTimestampUs,
            adaptive,
            payloadProof,
            timeline,
            cancellation,
            hooks
          ) { sampleBytes, timestampUs ->
            payloadCopied = Math.addExact(payloadCopied, sampleBytes)
            lastOutputTimestampUs = timestampUs
            reporter.report(
              ExportStage.MUXING,
              payloadCopied.toDouble() / payloadTarget.toDouble()
            )
          }
          if (copied != planned.estimatedEncodedBytes) {
            throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
          }
          outputBaseUs = Math.addExact(
            outputBaseUs,
            planned.effectiveEndUs - planned.effectiveStartUs
          )
        }
        timeline.finish()
      }
      if (payloadCopied != payloadTarget) throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
      muxer.stop()
      resource.markStopped()
      return MuxedM4a(outputBaseUs, payloadProof.finish(), timelineProof)
    } catch (error: Exception) {
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.M4A_MUX_FAILED, cause = error)
    } finally {
      resource.close()
    }
  }

  private fun copyClip(
    file: File,
    metadata: M4aTrackMetadata,
    planned: M4aPlannedClip,
    muxer: MediaMuxer,
    outputTrack: Int,
    outputBaseUs: Long,
    previousOutputTimestampUs: Long,
    adaptive: AdaptiveEncodedBuffer,
    payloadProof: EncodedStreamProofAccumulator,
    timelineProof: M4aTimelineProofWriter,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    onSample: (cumulativeClipBytes: Long, outputTimestampUs: Long) -> Unit
  ): Long {
    var clipBytes = 0L
    var lastTimestampUs = previousOutputTimestampUs
    scanner.openExtractor(file, hooks).use { resource ->
      val extractor = resource.extractor
      val current = try {
        scanner.requireM4aTrack(extractor)
      } catch (_: M4aIneligibleException) {
        throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
      }
      if (
        current.codecConfigFingerprint != metadata.codecConfigFingerprint ||
        current.sampleRateHz != metadata.sampleRateHz ||
        current.channelCount != metadata.channelCount
      ) {
        throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
      }
      extractor.selectTrack(current.trackIndex)
      extractor.seekTo(planned.effectiveStartUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      while (extractor.sampleTime in 0 until planned.effectiveStartUs) {
        if (!extractor.advance()) break
      }
      if (extractor.sampleTime != planned.effectiveStartUs) {
        throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
      }
      while (true) {
        cancellation.throwIfCancelled()
        val sourceTimestampUs = extractor.sampleTime
        val sampleSize = extractor.sampleSize
        if (sourceTimestampUs < 0L || sampleSize < 0L || sourceTimestampUs >= planned.effectiveEndUs) {
          break
        }
        val buffer = try {
          adaptive.requireCapacity(sampleSize)
        } catch (error: IllegalArgumentException) {
          throw mediaError(SnapCutMediaError.M4A_MUX_FAILED, cause = error)
        }
        val bytesRead = extractor.readSampleData(buffer, 0)
        if (bytesRead <= 0 || bytesRead.toLong() != sampleSize) {
          throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
        }
        val outputTimestampUs = M4aOutputTimestamp.rewrite(
          outputBaseUs,
          sourceTimestampUs,
          planned.effectiveStartUs
        )
        if (lastTimestampUs >= 0L && outputTimestampUs <= lastTimestampUs) {
          throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
        }
        val flags = extractor.sampleFlags
        val info = MediaCodec.BufferInfo().apply {
          set(0, bytesRead, outputTimestampUs, flags)
        }
        buffer.position(0)
        buffer.limit(bytesRead)
        payloadProof.add(flags, buffer, bytesRead)
        timelineProof.add(outputTimestampUs)
        muxer.writeSampleData(outputTrack, buffer, info)
        clipBytes = Math.addExact(clipBytes, bytesRead.toLong())
        lastTimestampUs = outputTimestampUs
        onSample(bytesRead.toLong(), lastTimestampUs)
        if (!extractor.advance()) break
      }
    }
    return clipBytes
  }

  private data class MuxedM4a(
    val durationUs: Long,
    val payloadProof: EncodedStreamProof,
    val timelineProof: M4aTimelineProof
  )

  private companion object {
    const val PLAN_VERSION = 1
    const val STAGING_FILE_NAME = "export.m4a.partial"
    const val TIMELINE_PROOF_FILE_NAME = "export.m4a.timeline-proof"
  }
}
