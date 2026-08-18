package expo.modules.snapcutmedia.export

import android.os.SystemClock
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.exportmedia.ExportFileAccess
import expo.modules.snapcutmedia.models.ExportAudioRequest
import expo.modules.snapcutmedia.models.ExportFormat
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.storage.PrivateOutputUri
import java.io.File

internal data class StagedDecodedExportResult(
  val format: ExportFormat,
  val outputFileUri: String,
  val requestedDurationMs: Long,
  val actualDurationMs: Long,
  val sampleRateHz: Int,
  val channelCount: Int,
  val bitrateKbps: Int?,
  val fileSizeBytes: Long,
  val outputPcmFrames: Long
)

internal data class DecodedExportProgress(
  val stage: String,
  val fraction: Double?
)

internal class DecodedExportService(
  private val projectRoots: Collection<File>,
  private val stagingRoots: Collection<File>,
  private val sourceProbe: DecodedSourceProbe = DecodedSourceProbe(),
  private val encoderFactory: CompositionEncoderFactory = NativeCompositionEncoderFactory(),
  private val verifier: CompletedDecodedOutputVerifier = CompletedDecodedOutputVerifier()
) {
  fun exportToStaging(
    request: ExportAudioRequest,
    outputFileUri: String,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE,
    progressSink: (DecodedExportProgress) -> Unit = {}
  ): StagedDecodedExportResult {
    val reporter = DecodedExportProgressReporter(progressSink)
    val clips = ExportFileAccess.resolveClips(request.clips, projectRoots)
    val output = PrivateOutputUri.requireSafeStagingUri(outputFileUri, stagingRoots)
    clips.forEach { clip ->
      if (clip.file.path == output.path) {
        throw mediaError(SnapCutMediaError.OUTPUT_ALIASES_SOURCE)
      }
    }
    val expectedSuffix = when (request.format) {
      ExportFormat.MP3 -> ".mp3"
      ExportFormat.M4A -> ".m4a"
    }
    if (!output.name.endsWith(expectedSuffix, ignoreCase = true) || output.exists()) {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
    }

    reporter.report("scanning", 0.0, force = true)
    val descriptors = linkedMapOf<String, DecodedSourceDescriptor>()
    clips.forEachIndexed { index, clip ->
      cancellation.throwIfCancelled()
      descriptors.getOrPut(clip.file.path) {
        sourceProbe.probe(clip.file, cancellation, hooks)
      }
      reporter.report("scanning", (index + 1.0) / clips.size)
    }
    val clipDescriptors = clips.map { clip ->
      descriptors.getValue(clip.file.path)
    }
    val outputConfig = DecodedExportPolicy.requireMatchingRequest(
      request,
      clipDescriptors.map(DecodedSourceDescriptor::outputFormat)
    )
    val requestedDurationMs = clips.maxOf { it.timelineEndMs }
    val estimatedOutputFrames = TimelinePcmMixer.timelineFrame(
      requestedDurationMs,
      outputConfig.sampleRateHz
    )

    var ownsOutput = false
    try {
      val parent = output.parentFile
      if ((!parent.exists() && !parent.mkdirs()) || !output.createNewFile()) {
        throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
      }
      ownsOutput = true
      cancellation.throwIfCancelled()
      reporter.report("decoding", 0.0, force = true)
      var writtenFrames = 0L
      encoderFactory.create(
        CompositionEncoderConfig(
          format = request.format,
          outputFile = output,
          sampleRateHz = outputConfig.sampleRateHz,
          channelCount = outputConfig.channelCount,
          totalFrames = estimatedOutputFrames,
          title = request.displayNameWithoutExtension,
          hooks = hooks
        )
      ).use { encoder ->
        TimelinePcmMixer().mix(
          clips = clips,
          descriptors = descriptors,
          outputRateHz = outputConfig.sampleRateHz,
          outputChannels = outputConfig.channelCount,
          cancellation = cancellation,
          hooks = hooks,
          sink = FloatPcmSink { pcm, frames ->
            cancellation.throwIfCancelled()
            encoder.write(pcm, frames)
            writtenFrames = Math.addExact(writtenFrames, frames.toLong())
          },
          progress = { fraction ->
            reporter.report("decoding", fraction)
          }
        )
        cancellation.throwIfCancelled()
        reporter.report("encoding", 1.0, force = true)
        encoder.finish()
      }
      cancellation.throwIfCancelled()
      if (writtenFrames <= 0L) throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      reporter.report("verifying", null, force = true)
      val verified = verifier.verify(
        output,
        request.format,
        writtenFrames,
        outputConfig.sampleRateHz,
        outputConfig.channelCount,
        cancellation,
        hooks
      )
      reporter.report("complete", 1.0, force = true)
      return StagedDecodedExportResult(
        format = request.format,
        outputFileUri = outputFileUri,
        requestedDurationMs = requestedDurationMs,
        actualDurationMs = verified.actualDurationMs,
        sampleRateHz = verified.sampleRateHz,
        channelCount = verified.channelCount,
        bitrateKbps = when (request.format) {
          ExportFormat.M4A -> if (outputConfig.channelCount == 1) 160 else 320
          ExportFormat.MP3 -> 320
        },
        fileSizeBytes = verified.fileSizeBytes,
        outputPcmFrames = writtenFrames
      )
    } catch (error: Exception) {
      if (ownsOutput) runCatching(output::delete)
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      val mapped = when (request.format) {
        ExportFormat.MP3 -> SnapCutMediaError.MP3_ENCODER_FAILED
        ExportFormat.M4A -> SnapCutMediaError.AAC_ENCODER_FAILED
      }
      throw mediaError(mapped)
    }
  }
}

private class DecodedExportProgressReporter(
  private val sink: (DecodedExportProgress) -> Unit,
  private val clockMs: () -> Long = SystemClock::elapsedRealtime
) {
  private var lastStage: String? = null
  private var lastEmissionMs = Long.MIN_VALUE

  fun report(stage: String, fraction: Double?, force: Boolean = false) {
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
    sink(
      DecodedExportProgress(
        stage,
        fraction?.takeIf(Double::isFinite)?.coerceIn(0.0, 1.0)
      )
    )
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 100L
  }
}
