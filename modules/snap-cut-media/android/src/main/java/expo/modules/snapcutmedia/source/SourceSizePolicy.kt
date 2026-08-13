package expo.modules.snapcutmedia.source

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError

internal object SourceSizePolicy {
  const val MAX_SOURCE_BYTES = 600L * 1024L * 1024L
  const val STREAM_BUFFER_BYTES = 64 * 1024

  data class Resolution(
    val reportedSizeBytes: Long?,
    val requiresStreamingVerification: Boolean,
    val candidatesDisagree: Boolean
  )

  fun normalizeReportedSize(value: Long?): Long? = value?.takeIf { it > 0L }

  fun resolveReportedSizes(
    openableColumnsSize: Long?,
    assetFileDescriptorLength: Long?,
    parcelFileDescriptorStatSize: Long?
  ): Resolution {
    val values = listOfNotNull(
      normalizeReportedSize(openableColumnsSize),
      normalizeReportedSize(assetFileDescriptorLength),
      normalizeReportedSize(parcelFileDescriptorStatSize)
    )
    val disagree = values.distinct().size > 1
    return Resolution(
      reportedSizeBytes = values.maxOrNull(),
      requiresStreamingVerification = values.isEmpty() || disagree,
      candidatesDisagree = disagree
    )
  }

  fun effectiveLimit(requestedMaxSourceBytes: Long): Long {
    if (requestedMaxSourceBytes <= 0L) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    return minOf(requestedMaxSourceBytes, MAX_SOURCE_BYTES)
  }

  fun requireReportedSizeWithinLimit(sizeBytes: Long?, requestedMaxSourceBytes: Long) {
    val normalized = normalizeReportedSize(sizeBytes) ?: return
    if (normalized > effectiveLimit(requestedMaxSourceBytes)) {
      throw mediaError(SnapCutMediaError.SOURCE_TOO_LARGE)
    }
  }

  /** Returns the maximum byte count a bounded reader may consume (limit + 1). */
  fun boundedReadByteCount(requestedMaxSourceBytes: Long): Long =
    Math.addExact(effectiveLimit(requestedMaxSourceBytes), 1L)

  fun requireStreamedSizeWithinLimit(bytesRead: Long, requestedMaxSourceBytes: Long) {
    if (bytesRead < 0L) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    if (bytesRead > effectiveLimit(requestedMaxSourceBytes)) {
      throw mediaError(SnapCutMediaError.SOURCE_TOO_LARGE)
    }
  }
}
