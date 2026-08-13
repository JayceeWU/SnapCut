package expo.modules.snapcutmedia.exportmedia

import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.M4aPlannedClip
import expo.modules.snapcutmedia.models.M4aSourceSnapshot
import expo.modules.snapcutmedia.source.AacCodecData
import expo.modules.snapcutmedia.source.AudioTrackPolicy
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import java.io.File
import kotlin.math.abs
import kotlin.math.roundToLong

internal class M4aIneligibleException(val safeReason: String) : Exception(safeReason)

internal object M4aSnapshotPolicy {
  fun requireMetadata(snapshot: M4aSourceSnapshot, fileSizeBytes: Long, lastModifiedEpochMs: Long) {
    if (
      fileSizeBytes != snapshot.fileSizeBytes ||
      lastModifiedEpochMs != snapshot.lastModifiedEpochMs
    ) {
      throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
    }
  }

  fun requireContent(
    snapshot: M4aSourceSnapshot,
    sha256: String,
    codecConfigFingerprint: String,
    expectedCodecConfigFingerprint: String
  ) {
    if (
      sha256 != snapshot.privateAudioSha256 ||
      snapshot.codecConfigFingerprint != expectedCodecConfigFingerprint ||
      codecConfigFingerprint != expectedCodecConfigFingerprint
    ) {
      throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
    }
  }
}

internal data class M4aSourcePlan(
  val sourceId: String,
  val snapshot: M4aSourceSnapshot,
  val codecConfigFingerprint: String,
  val sampleRateHz: Int,
  val channelCount: Int,
  val trackDurationUs: Long,
  val plannedClips: List<M4aPlannedClip>
)

internal data class M4aTrackMetadata(
  val trackIndex: Int,
  val format: MediaFormat,
  val codecConfigFingerprint: String,
  val sampleRateHz: Int,
  val channelCount: Int,
  val durationUs: Long
)

internal class M4aSourceScanner {
  fun scan(
    sourceId: String,
    file: File,
    clips: List<ResolvedExportClip>,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): M4aSourcePlan {
    val beforeSize = file.length()
    val beforeModified = file.lastModified()
    if (beforeSize <= 0L) throw mediaError(SnapCutMediaError.MISSING_SOURCE_FILE)
    val beforeHash = ExportFileAccess.sha256(file, cancellation, hooks)
    val selectors = clips.associate { clip ->
      val requestedStartUs = millisecondsToMicroseconds(clip.startMs)
      val requestedEndUs = millisecondsToMicroseconds(clip.endMs)
      clip.clipId to EndpointSelectors(
        NearestBoundarySelector(requestedStartUs, BoundaryRole.START),
        NearestBoundarySelector(requestedEndUs, BoundaryRole.END)
      )
    }
    val metadata = openExtractor(file, hooks).use { resource ->
      val extractor = resource.extractor
      val track = requireM4aTrack(extractor)
      scanBoundaries(extractor, track, selectors, cancellation)
      track
    }
    val endpoints = clips.associate { clip ->
      val selected = selectors.getValue(clip.clipId)
      val start = selected.start.finish()
        ?: throw M4aIneligibleException(BOUNDARY_REASON)
      val end = selected.end.finish()
        ?: throw M4aIneligibleException(BOUNDARY_REASON)
      if (start.effectiveUs >= end.effectiveUs) {
        throw M4aIneligibleException(COMPLETE_UNIT_REASON)
      }
      clip.clipId to EffectiveEndpoints(start, end)
    }
    val encodedBytes = scanPayloadSizes(file, metadata.trackIndex, endpoints, cancellation, hooks)
    val afterHash = ExportFileAccess.sha256(file, cancellation, hooks)
    if (
      file.length() != beforeSize ||
      file.lastModified() != beforeModified ||
      afterHash != beforeHash
    ) {
      throw mediaError(SnapCutMediaError.EXPORT_PREFLIGHT_FAILED)
    }
    val planned = clips.map { clip ->
      val boundary = endpoints.getValue(clip.clipId)
      val bytes = encodedBytes.getValue(clip.clipId)
      if (bytes <= 0L) throw M4aIneligibleException(COMPLETE_UNIT_REASON)
      M4aPlannedClip(
        clipId = clip.clipId,
        sourceId = sourceId,
        requestedStartMs = clip.startMs,
        requestedEndMs = clip.endMs,
        effectiveStartUs = boundary.start.effectiveUs,
        effectiveEndUs = boundary.end.effectiveUs,
        startAdjustmentMs = boundary.start.adjustmentMs,
        endAdjustmentMs = boundary.end.adjustmentMs,
        estimatedEncodedBytes = bytes
      )
    }
    return M4aSourcePlan(
      sourceId = sourceId,
      snapshot = M4aSourceSnapshot(
        sourceId,
        afterHash,
        metadata.codecConfigFingerprint,
        beforeSize,
        beforeModified
      ),
      codecConfigFingerprint = metadata.codecConfigFingerprint,
      sampleRateHz = metadata.sampleRateHz,
      channelCount = metadata.channelCount,
      trackDurationUs = metadata.durationUs,
      plannedClips = planned
    )
  }

  fun requireCurrentSnapshot(
    file: File,
    snapshot: M4aSourceSnapshot,
    expectedFingerprint: String,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): M4aTrackMetadata {
    M4aSnapshotPolicy.requireMetadata(snapshot, file.length(), file.lastModified())
    val hash = try {
      ExportFileAccess.sha256(file, cancellation, hooks)
    } catch (error: Exception) {
      cancellation.throwIfCancelled()
      if (error is SnapCutMediaException) throw error
      throw mediaError(SnapCutMediaError.M4A_PLAN_STALE, cause = error)
    }
    val metadata = openExtractor(file, hooks).use { resource ->
      val current = requireM4aTrack(resource.extractor)
      requireValidAccessUnitTimeline(resource.extractor, current, cancellation)
      current
    }
    M4aSnapshotPolicy.requireContent(
      snapshot,
      hash,
      metadata.codecConfigFingerprint,
      expectedFingerprint
    )
    M4aSnapshotPolicy.requireMetadata(snapshot, file.length(), file.lastModified())
    return metadata
  }

  private fun requireValidAccessUnitTimeline(
    extractor: MediaExtractor,
    metadata: M4aTrackMetadata,
    cancellation: CancellationCheck
  ) {
    scanBoundaries(extractor, metadata, emptyMap(), cancellation)
  }

  fun openExtractor(file: File, hooks: MediaResourceHooks): ExportExtractorResource {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.absolutePath)
      return ExportExtractorResource(extractor, hooks)
    } catch (error: Exception) {
      runCatching(extractor::release)
      throw mediaError(SnapCutMediaError.M4A_PLAN_STALE, cause = error)
    }
  }

  fun requireM4aTrack(extractor: MediaExtractor): M4aTrackMetadata {
    if (runCatching { extractor.psshInfo?.isNotEmpty() == true }.getOrDefault(false)) {
      throw M4aIneligibleException(DRM_REASON)
    }
    val audioTracks = mutableListOf<Pair<Int, MediaFormat>>()
    var hasNonAudioTrack = false
    for (index in 0 until extractor.trackCount) {
      val format = extractor.getTrackFormat(index)
      val mime = format.string(MediaFormat.KEY_MIME)?.lowercase()
      if (mime == null || !mime.startsWith("audio/")) {
        hasNonAudioTrack = true
      } else {
        audioTracks += index to format
      }
    }
    if (hasNonAudioTrack || audioTracks.size != 1) {
      throw M4aIneligibleException(AAC_ONLY_REASON)
    }
    val (trackIndex, format) = audioTracks.single()
    val mime = format.string(MediaFormat.KEY_MIME)?.lowercase()
    val objectType = AacCodecData.objectType(format)
    val sampleRate = format.integer(MediaFormat.KEY_SAMPLE_RATE) ?: 0
    val channels = format.integer(MediaFormat.KEY_CHANNEL_COUNT) ?: 0
    val duration = format.long(MediaFormat.KEY_DURATION) ?: 0L
    val delay = format.long(MediaFormat.KEY_ENCODER_DELAY) ?: 0L
    val padding = format.long(MediaFormat.KEY_ENCODER_PADDING) ?: 0L
    val encrypted = format.integer("is-encrypted") == 1 || format.integer("crypto-mode") != null
    if (encrypted) throw M4aIneligibleException(DRM_REASON)
    if (
      mime != AudioTrackPolicy.MIME_AAC ||
      objectType != MediaCodecInfo.CodecProfileLevel.AACObjectLC ||
      sampleRate <= 0 ||
      channels !in 1..2 ||
      duration <= 0L
    ) {
      throw M4aIneligibleException(AAC_ONLY_REASON)
    }
    if (delay != 0L || padding != 0L) {
      throw M4aIneligibleException(DELAY_PADDING_REASON)
    }
    return M4aTrackMetadata(
      trackIndex,
      format,
      AacCodecData.fingerprint(format, mime, sampleRate, channels, objectType),
      sampleRate,
      channels,
      duration
    )
  }

  fun requirePrivateM4aSource(file: File) {
    val name = file.name.lowercase()
    if (name != "source.m4a") {
      throw M4aIneligibleException(AAC_ONLY_REASON)
    }
  }

  fun requireValidTimeline(
    extractor: MediaExtractor,
    metadata: M4aTrackMetadata,
    cancellation: CancellationCheck
  ) {
    requireValidAccessUnitTimeline(extractor, metadata, cancellation)
  }

  fun resetExtractor(extractor: MediaExtractor, metadata: M4aTrackMetadata) {
    extractor.unselectTrack(metadata.trackIndex)
    extractor.selectTrack(metadata.trackIndex)
    extractor.seekTo(0L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
  }

  private fun scanBoundaries(
    extractor: MediaExtractor,
    metadata: M4aTrackMetadata,
    selectors: Map<String, EndpointSelectors>,
    cancellation: CancellationCheck
  ) {
    extractor.selectTrack(metadata.trackIndex)
    val nominalFrameUs = (AAC_LC_SAMPLES_PER_ACCESS_UNIT * 1_000_000.0 / metadata.sampleRateHz)
      .roundToLong()
    var firstTimestampUs = -1L
    var previousTimestampUs = -1L
    var lastTimestampUs = -1L
    var sampleCount = 0L
    while (true) {
      cancellation.throwIfCancelled()
      val timestampUs = extractor.sampleTime
      val size = extractor.sampleSize
      if (timestampUs < 0L || size < 0L) break
      if (
        size <= 0L ||
        size > MAX_ENCODED_SAMPLE_BYTES ||
        extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_ENCRYPTED != 0 ||
        (previousTimestampUs >= 0L && timestampUs <= previousTimestampUs)
      ) {
        throw M4aIneligibleException(TIMESTAMP_REASON)
      }
      if (firstTimestampUs < 0L) firstTimestampUs = timestampUs
      if (
        previousTimestampUs >= 0L &&
        abs((timestampUs - previousTimestampUs) - nominalFrameUs) > FRAME_DURATION_TOLERANCE_US
      ) {
        throw M4aIneligibleException(TIMESTAMP_REASON)
      }
      selectors.values.forEach { it.accept(timestampUs) }
      previousTimestampUs = timestampUs
      lastTimestampUs = timestampUs
      sampleCount++
      if (!extractor.advance()) break
    }
    if (sampleCount == 0L || firstTimestampUs != 0L || lastTimestampUs < 0L) {
      throw M4aIneligibleException(TIMESTAMP_REASON)
    }
    val finalBoundaryUs = try {
      Math.addExact(lastTimestampUs, nominalFrameUs)
    } catch (_: ArithmeticException) {
      throw M4aIneligibleException(FINAL_BOUNDARY_REASON)
    }
    if (abs(finalBoundaryUs - metadata.durationUs) > FINAL_BOUNDARY_TOLERANCE_US) {
      throw M4aIneligibleException(FINAL_BOUNDARY_REASON)
    }
    selectors.values.forEach { it.accept(finalBoundaryUs) }
  }

  private fun scanPayloadSizes(
    file: File,
    trackIndex: Int,
    endpoints: Map<String, EffectiveEndpoints>,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks
  ): Map<String, Long> {
    val totals = endpoints.keys.associateWith { 0L }.toMutableMap()
    openExtractor(file, hooks).use { resource ->
      val extractor = resource.extractor
      extractor.selectTrack(trackIndex)
      while (true) {
        cancellation.throwIfCancelled()
        val timestampUs = extractor.sampleTime
        val size = extractor.sampleSize
        if (timestampUs < 0L || size < 0L) break
        if (size <= 0L || size > MAX_ENCODED_SAMPLE_BYTES) {
          throw M4aIneligibleException(TIMESTAMP_REASON)
        }
        endpoints.forEach { (clipId, range) ->
          if (timestampUs >= range.start.effectiveUs && timestampUs < range.end.effectiveUs) {
            totals[clipId] = try {
              Math.addExact(totals.getValue(clipId), size)
            } catch (_: ArithmeticException) {
              throw M4aIneligibleException(TIMESTAMP_REASON)
            }
          }
        }
        if (!extractor.advance()) break
      }
    }
    return totals
  }

  private fun EndpointSelectors.accept(boundaryUs: Long) {
    start.accept(boundaryUs)
    end.accept(boundaryUs)
  }

  private fun millisecondsToMicroseconds(value: Long): Long = try {
    Math.multiplyExact(value, 1000L)
  } catch (_: ArithmeticException) {
    throw M4aIneligibleException(BOUNDARY_REASON)
  }

  private fun MediaFormat.integer(key: String): Int? =
    if (containsKey(key)) runCatching { getInteger(key) }.getOrNull() else null

  private fun MediaFormat.long(key: String): Long? = if (!containsKey(key)) {
    null
  } else {
    runCatching { getLong(key) }.getOrNull()
      ?: runCatching { getInteger(key).toLong() }.getOrNull()
  }

  private fun MediaFormat.string(key: String): String? =
    if (containsKey(key)) runCatching { getString(key) }.getOrNull() else null

  private data class EndpointSelectors(
    val start: NearestBoundarySelector,
    val end: NearestBoundarySelector
  )

  private data class EffectiveEndpoints(
    val start: PlannedBoundary,
    val end: PlannedBoundary
  )

  private companion object {
    const val AAC_LC_SAMPLES_PER_ACCESS_UNIT = 1024L
    const val MAX_ENCODED_SAMPLE_BYTES = 16L * 1024L * 1024L
    const val FRAME_DURATION_TOLERANCE_US = 2_000L
    const val FINAL_BOUNDARY_TOLERANCE_US = 2_000L
    const val AAC_ONLY_REASON = "M4A requires audio-only AAC-LC sources with one audio track."
    const val DRM_REASON = "A selected source contains protected audio."
    const val DELAY_PADDING_REASON = "A selected source contains encoder delay or padding."
    const val TIMESTAMP_REASON = "A selected AAC source has unsupported or malformed timestamps."
    const val FINAL_BOUNDARY_REASON = "The final AAC access-unit boundary cannot be proven."
    const val BOUNDARY_REASON = "A cut point cannot be aligned within 20 milliseconds."
    const val COMPLETE_UNIT_REASON = "A selected range does not contain a complete AAC access unit."
  }
}
