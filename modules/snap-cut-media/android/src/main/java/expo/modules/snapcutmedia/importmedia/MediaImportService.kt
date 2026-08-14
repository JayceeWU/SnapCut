package expo.modules.snapcutmedia.importmedia

import android.media.MediaCodec
import android.media.MediaMuxer
import android.os.StatFs
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.models.ImportSourceRequest
import expo.modules.snapcutmedia.models.ImportedSourceResult
import expo.modules.snapcutmedia.models.SourceInspection
import expo.modules.snapcutmedia.models.SourceKind
import expo.modules.snapcutmedia.source.BoundedSourceIo
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.source.SourceInspector
import expo.modules.snapcutmedia.source.SourceSession
import expo.modules.snapcutmedia.storage.PrivateOutputUri
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.math.BigInteger
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

internal class MediaImportService(
  private val inspector: SourceInspector,
  private val stagingRoots: Collection<File>
) {
  fun importSource(
    request: ImportSourceRequest,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks = MediaResourceHooks.NONE,
    progressSink: (ImportProgress) -> Unit = {}
  ): ImportedSourceResult {
    if (request.jobId.isBlank() || request.generation < 0L) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    val output = PrivateOutputUri.requireSafeStagingUri(
      request.outputFileUri,
      stagingRoots,
      request.sourceUri
    )
    if (!output.parentFile.exists() && !output.parentFile.mkdirs()) {
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
    }
    val reporter = ImportProgressReporter(progressSink)
    try {
      cancellation.throwIfCancelled()
      if (output.exists() && !output.delete()) {
        throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED)
      }
      reporter.report(ImportStage.INSPECTING, null, force = true)
      inspector.openSession(
        request.sourceUri,
        request.maxSourceBytes,
        cancellation,
        hooks
      ).use { session ->
        val inspected = inspector.inspectSession(session, cancellation)
        val videoTrackMeasurement = if (
          inspected.inspection.sourceKind == SourceKind.VIDEO_EXTRACTED_AAC
        ) {
          measureTrackPayloadBytes(
            session,
            inspected.selectedTrackIndex,
            cancellation
          )
        } else {
          null
        }
        requireOutputCapacity(
          output,
          ImportOutputEstimate.estimate(
            inspected.inspection,
            session.actualSizeBytes,
            videoTrackMeasurement
          )
        )
        reporter.report(ImportStage.EXTRACTING_OR_COPYING, 0.0, 0L, session.actualSizeBytes, true)
        when (inspected.inspection.sourceKind) {
          SourceKind.VIDEO_EXTRACTED_AAC,
          SourceKind.M4A,
          SourceKind.M4S_AAC -> remuxAac(
            session,
            inspected.selectedTrackIndex,
            inspected.inspection.durationMs * 1000L,
            output,
            cancellation,
            hooks,
            reporter
          )
          SourceKind.MP3,
          SourceKind.FLAC,
          SourceKind.WAV -> copySource(
            session,
            output,
            request.maxSourceBytes,
            cancellation,
            hooks,
            reporter
          )
        }
        cancellation.throwIfCancelled()
        reporter.report(ImportStage.VERIFYING, null, force = true)
        val verified = inspector.inspect(
          output.toURI().toString(),
          request.maxSourceBytes,
          cancellation,
          hooks
        )
        verifyInspection(inspected.inspection, verified)
        val outputSize = output.length().takeIf { it > 0L }
          ?: throw mediaError(SnapCutMediaError.IMPORT_VERIFICATION_FAILED)
        val hash = sha256(output, cancellation, hooks)
        reporter.report(ImportStage.COMMITTING, null, outputSize, outputSize, true)
        reporter.report(ImportStage.COMPLETE, 1.0, outputSize, outputSize, true)
        val source = inspected.inspection
        return ImportedSourceResult(
          outputFileUri = request.outputFileUri,
          sourceKind = source.sourceKind,
          codecMime = source.codecMime,
          durationMs = source.durationMs,
          sampleRateHz = source.sampleRateHz,
          channelCount = source.channelCount,
          encodedBitrateBps = source.encodedBitrateBps,
          pcmBitsPerSample = source.pcmBitsPerSample,
          aacProfile = source.aacProfile,
          codecConfigFingerprint = source.codecConfigFingerprint,
          encoderDelayFrames = source.encoderDelayFrames,
          encoderPaddingFrames = source.encoderPaddingFrames,
          fileSizeBytes = outputSize,
          privateAudioSha256 = hash
        )
      }
    } catch (error: Exception) {
      runCatching { if (output.exists()) output.delete() }
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.OUTPUT_WRITE_FAILED, cause = error)
    }
  }

  private fun copySource(
    session: SourceSession,
    output: File,
    maxSourceBytes: Long,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    reporter: ImportProgressReporter
  ) {
    session.openInputStream().use { input ->
      FileOutputStream(output).use { stream ->
        val resource = CloseableResource(stream, hooks)
        try {
          val total = session.actualSizeBytes
          BoundedSourceIo.copy(input, stream, maxSourceBytes, cancellation) { copied ->
            reporter.report(
              ImportStage.EXTRACTING_OR_COPYING,
              total?.takeIf { it > 0L }?.let { copied.toDouble() / it.toDouble() },
              copied,
              total
            )
          }
          stream.fd.sync()
        } finally {
          resource.close()
        }
      }
    }
  }

  private fun remuxAac(
    session: SourceSession,
    trackIndex: Int,
    durationUs: Long,
    output: File,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    reporter: ImportProgressReporter
  ) {
    session.openExtractor().use { managed ->
      val extractor = managed.extractor
      extractor.selectTrack(trackIndex)
      val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val resource = MuxerResource(muxer, hooks)
      var started = false
      var completed = false
      try {
        val outputTrack = muxer.addTrack(extractor.getTrackFormat(trackIndex))
        muxer.start()
        started = true
        var buffer = ByteBuffer.allocateDirect(INITIAL_SAMPLE_BUFFER_BYTES)
        val info = MediaCodec.BufferInfo()
        var firstTimestampUs = -1L
        var lastTimestampUs = -1L
        while (true) {
          cancellation.throwIfCancelled()
          val sampleSize = extractor.sampleSize
          if (sampleSize < 0L) break
          if (sampleSize > MAX_SAMPLE_BUFFER_BYTES) {
            throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
          }
          if (sampleSize > buffer.capacity()) {
            buffer = ByteBuffer.allocateDirect(sampleSize.toInt())
          }
          buffer.clear()
          val bytesRead = extractor.readSampleData(buffer, 0)
          if (bytesRead < 0) break
          val sourceTimestampUs = extractor.sampleTime
          if (sourceTimestampUs < 0L) break
          if (firstTimestampUs < 0L) firstTimestampUs = sourceTimestampUs
          val timestampUs = sourceTimestampUs - firstTimestampUs
          if (timestampUs < 0L || (lastTimestampUs >= 0L && timestampUs <= lastTimestampUs)) {
            throw mediaError(SnapCutMediaError.IMPORT_VERIFICATION_FAILED)
          }
          info.set(0, bytesRead, timestampUs, extractor.sampleFlags)
          muxer.writeSampleData(outputTrack, buffer, info)
          lastTimestampUs = timestampUs
          reporter.report(
            ImportStage.EXTRACTING_OR_COPYING,
            durationUs.takeIf { it > 0L }?.let { timestampUs.toDouble() / it.toDouble() }
          )
          if (!extractor.advance()) break
        }
        if (firstTimestampUs < 0L) throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
        muxer.stop()
        started = false
        completed = true
      } finally {
        if (started) runCatching(muxer::stop)
        resource.close()
        if (!completed) runCatching { output.delete() }
      }
    }
  }

  private fun verifyInspection(before: SourceInspection, after: SourceInspection) {
    val aac = before.sourceKind in setOf(
      SourceKind.VIDEO_EXTRACTED_AAC,
      SourceKind.M4A,
      SourceKind.M4S_AAC
    )
    val durationToleranceMs = if (aac) {
      maxOf(50L, (2048L * 1000L) / before.sampleRateHz)
    } else {
      2L
    }
    val compatible =
      before.codecMime == after.codecMime &&
        before.sampleRateHz == after.sampleRateHz &&
        before.channelCount == after.channelCount &&
        before.pcmBitsPerSample == after.pcmBitsPerSample &&
        before.aacProfile == after.aacProfile &&
        before.codecConfigFingerprint == after.codecConfigFingerprint &&
        before.encoderDelayFrames == after.encoderDelayFrames &&
        before.encoderPaddingFrames == after.encoderPaddingFrames &&
        abs(before.durationMs - after.durationMs) <= durationToleranceMs
    if (!compatible) throw mediaError(SnapCutMediaError.IMPORT_VERIFICATION_FAILED)
  }

  private fun measureTrackPayloadBytes(
    session: SourceSession,
    trackIndex: Int,
    cancellation: CancellationCheck
  ): TrackPayloadMeasurement {
    try {
      session.openExtractor().use { managed ->
        val extractor = managed.extractor
        extractor.selectTrack(trackIndex)
        var payloadBytes = 0L
        var sampleCount = 0L
        while (true) {
          cancellation.throwIfCancelled()
          val sampleSize = extractor.sampleSize
          if (sampleSize < 0L) break
          if (sampleSize <= 0L || sampleSize > MAX_SAMPLE_BUFFER_BYTES) {
            throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
          }
          payloadBytes = Math.addExact(payloadBytes, sampleSize)
          sampleCount = Math.addExact(sampleCount, 1L)
          if (!extractor.advance()) break
        }
        if (payloadBytes <= 0L || sampleCount <= 0L) {
          throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
        }
        return TrackPayloadMeasurement(payloadBytes, sampleCount)
      }
    } catch (error: Exception) {
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.CORRUPT_MEDIA, cause = error)
    }
  }

  private fun requireOutputCapacity(output: File, estimatedBytes: Long) {
    val required = try {
      Math.addExact(estimatedBytes, WORKING_MARGIN_BYTES)
    } catch (_: ArithmeticException) {
      Long.MAX_VALUE
    }
    if (StatFs(output.parentFile.absolutePath).availableBytes < required) {
      throw mediaError(SnapCutMediaError.DISK_SPACE_LOW)
    }
  }

  private fun sha256(
    file: File,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val resource = CloseableResource(input, hooks)
      try {
        val buffer = ByteArray(HASH_BUFFER_BYTES)
        while (true) {
          cancellation.throwIfCancelled()
          val read = input.read(buffer)
          if (read < 0) break
          if (read > 0) digest.update(buffer, 0, read)
        }
      } finally {
        resource.close()
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private class CloseableResource(
    private val closeable: Closeable,
    private val hooks: MediaResourceHooks
  ) : Closeable, NativeJobResource {
    private val closed = AtomicBoolean(false)

    init {
      hooks.attach(this)
    }

    override fun close() = cancel()

    override fun cancel() {
      if (!closed.compareAndSet(false, true)) return
      hooks.detach(this)
      runCatching(closeable::close)
    }
  }

  private class MuxerResource(
    private val muxer: MediaMuxer,
    private val hooks: MediaResourceHooks
  ) : Closeable, NativeJobResource {
    private val closed = AtomicBoolean(false)

    init {
      hooks.attach(this)
    }

    override fun close() = cancel()

    override fun cancel() {
      if (!closed.compareAndSet(false, true)) return
      hooks.detach(this)
      runCatching(muxer::release)
    }
  }

  private companion object {
    const val INITIAL_SAMPLE_BUFFER_BYTES = 1024 * 1024
    const val MAX_SAMPLE_BUFFER_BYTES = 16L * 1024L * 1024L
    const val HASH_BUFFER_BYTES = 64 * 1024
    const val WORKING_MARGIN_BYTES = 16L * 1024L * 1024L
  }
}

internal data class TrackPayloadMeasurement(
  val payloadBytes: Long,
  val sampleCount: Long
)

internal object ImportOutputEstimate {
  private val LONG_MAX = BigInteger.valueOf(Long.MAX_VALUE)
  private val ONE_HUNDRED = BigInteger.valueOf(100L)
  private val EIGHT_THOUSAND = BigInteger.valueOf(8_000L)

  fun estimate(
    inspection: SourceInspection,
    sourceSizeBytes: Long?,
    videoTrackMeasurement: TrackPayloadMeasurement?
  ): Long = when (inspection.sourceKind) {
    SourceKind.VIDEO_EXTRACTED_AAC -> {
      val measurement = videoTrackMeasurement
        ?.takeIf { it.payloadBytes > 0L && it.sampleCount > 0L }
        ?: throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
      val conservativeBitrate = maxOf(
        inspection.encodedBitrateBps ?: 0L,
        CONSERVATIVE_STEREO_AAC_BITRATE_BPS
      )
      maxOf(
        withMuxOverhead(
          BigInteger.valueOf(measurement.payloadBytes),
          measurement.sampleCount
        ),
        bitrateEstimate(inspection.durationMs, conservativeBitrate)
      )
    }
    SourceKind.M4A,
    SourceKind.M4S_AAC -> inspection.encodedBitrateBps
      ?.takeIf { it > 0L }
      ?.let { bitrateEstimate(inspection.durationMs, it) }
      ?: sourceSizeBytes?.takeIf { it > 0L }
      ?: SOURCE_SIZE_FALLBACK_BYTES
    SourceKind.MP3,
    SourceKind.FLAC,
    SourceKind.WAV -> sourceSizeBytes?.takeIf { it > 0L } ?: SOURCE_SIZE_FALLBACK_BYTES
  }

  private fun bitrateEstimate(durationMs: Long, bitrateBps: Long): Long {
    if (durationMs <= 0L || bitrateBps <= 0L) {
      throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
    }
    val payload = ceilDivide(
      BigInteger.valueOf(durationMs).multiply(BigInteger.valueOf(bitrateBps)),
      EIGHT_THOUSAND
    )
    return withMuxOverhead(payload, 0L)
  }

  private fun withMuxOverhead(payload: BigInteger, sampleCount: Long): Long {
    val percentage = ceilDivide(payload.multiply(BigInteger.valueOf(5L)), ONE_HUNDRED)
    val sampleTable = BigInteger.valueOf(sampleCount)
      .multiply(BigInteger.valueOf(BYTES_PER_SAMPLE_TABLE_ENTRY))
    val overhead = maxOf(
      percentage,
      sampleTable,
      BigInteger.valueOf(MINIMUM_MUX_OVERHEAD_BYTES)
    )
    return payload.add(overhead).min(LONG_MAX).toLong()
  }

  private fun ceilDivide(value: BigInteger, divisor: BigInteger): BigInteger =
    value.add(divisor).subtract(BigInteger.ONE).divide(divisor)

  private const val CONSERVATIVE_STEREO_AAC_BITRATE_BPS = 640_000L
  private const val BYTES_PER_SAMPLE_TABLE_ENTRY = 32L
  private const val MINIMUM_MUX_OVERHEAD_BYTES = 64L * 1024L
  private const val SOURCE_SIZE_FALLBACK_BYTES = 600L * 1024L * 1024L
}
