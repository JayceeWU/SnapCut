package expo.modules.snapcutmedia.models

/** Explicit JS bridge representation; do not rely on enum/record reflection here. */
internal object SourceInspectionBridgeContract {
  val FIELD_NAMES = listOf(
    "sourceKind",
    "codecMime",
    "durationMs",
    "sampleRateHz",
    "channelCount",
    "encodedBitrateBps",
    "pcmBitsPerSample",
    "aacProfile",
    "codecConfigFingerprint",
    "encoderDelayFrames",
    "encoderPaddingFrames",
    "fileSizeBytes",
    "requiresStreamingSizeVerification",
    "drmProtected"
  )
}

internal fun SourceInspection.toBridgeMap(): Map<String, Any?> = linkedMapOf(
  "sourceKind" to sourceKind.value,
  "codecMime" to codecMime,
  "durationMs" to durationMs,
  "sampleRateHz" to sampleRateHz,
  "channelCount" to channelCount,
  "encodedBitrateBps" to encodedBitrateBps,
  "pcmBitsPerSample" to pcmBitsPerSample,
  "aacProfile" to aacProfile?.value,
  "codecConfigFingerprint" to codecConfigFingerprint,
  "encoderDelayFrames" to encoderDelayFrames,
  "encoderPaddingFrames" to encoderPaddingFrames,
  "fileSizeBytes" to fileSizeBytes,
  "requiresStreamingSizeVerification" to requiresStreamingSizeVerification,
  "drmProtected" to drmProtected
)

/** Explicit import-result bridge contract; enums must never rely on Record reflection. */
internal object ImportedSourceResultBridgeContract {
  val FIELD_NAMES = listOf(
    "outputFileUri",
    "sourceKind",
    "codecMime",
    "durationMs",
    "sampleRateHz",
    "channelCount",
    "encodedBitrateBps",
    "pcmBitsPerSample",
    "aacProfile",
    "codecConfigFingerprint",
    "encoderDelayFrames",
    "encoderPaddingFrames",
    "fileSizeBytes",
    "privateAudioSha256"
  )
}

internal fun ImportedSourceResult.toBridgeMap(): Map<String, Any?> = linkedMapOf(
  "outputFileUri" to outputFileUri,
  "sourceKind" to sourceKind.value,
  "codecMime" to codecMime,
  "durationMs" to durationMs,
  "sampleRateHz" to sampleRateHz,
  "channelCount" to channelCount,
  "encodedBitrateBps" to encodedBitrateBps,
  "pcmBitsPerSample" to pcmBitsPerSample,
  "aacProfile" to aacProfile?.value,
  "codecConfigFingerprint" to codecConfigFingerprint,
  "encoderDelayFrames" to encoderDelayFrames,
  "encoderPaddingFrames" to encoderPaddingFrames,
  "fileSizeBytes" to fileSizeBytes,
  "privateAudioSha256" to privateAudioSha256
)
