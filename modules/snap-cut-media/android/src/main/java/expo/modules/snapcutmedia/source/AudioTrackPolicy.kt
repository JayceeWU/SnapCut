package expo.modules.snapcutmedia.source

import android.media.AudioFormat
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.AacProfile
import expo.modules.snapcutmedia.models.SourceKind
import java.nio.ByteBuffer
import java.security.MessageDigest

internal data class AudioTrackCandidate(
  val index: Int,
  val format: MediaFormat,
  val mime: String,
  val durationUs: Long,
  val sampleRateHz: Int,
  val channelCount: Int,
  val encodedBitrateBps: Long?,
  val pcmBitsPerSample: Int?,
  val aacProfile: AacProfile?,
  val aacObjectType: Int?,
  val codecConfigFingerprint: String?,
  val encoderDelayFrames: Long?,
  val encoderPaddingFrames: Long?,
  val encrypted: Boolean,
  val decoderAvailable: Boolean
)

internal data class SelectedAudioTrack(
  val candidate: AudioTrackCandidate,
  val sourceKind: SourceKind
)

internal fun interface DecoderAvailability {
  fun hasDecoder(format: MediaFormat): Boolean
}

internal object PlatformDecoderAvailability : DecoderAvailability {
  override fun hasDecoder(format: MediaFormat): Boolean = runCatching {
    MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(format) != null
  }.getOrDefault(false)
}

internal object AudioTrackPolicy {
  const val MIME_AAC = "audio/mp4a-latm"
  private val MP3_MIMES = setOf("audio/mpeg", "audio/mp3")
  private val FLAC_MIMES = setOf("audio/flac", "audio/x-flac")
  private val PCM_MIMES = setOf("audio/raw", "audio/wav", "audio/x-wav", "audio/vnd.wave")

  fun collect(
    extractor: MediaExtractor,
    probe: ContainerProbe,
    decoderAvailability: DecoderAvailability = PlatformDecoderAvailability,
    onDecoderCheck: () -> Unit = {}
  ): Pair<List<AudioTrackCandidate>, Boolean> {
    val candidates = mutableListOf<AudioTrackCandidate>()
    var hasVideo = false
    for (index in 0 until extractor.trackCount) {
      val format = extractor.getTrackFormat(index)
      val mime = format.string(MediaFormat.KEY_MIME)?.lowercase() ?: continue
      if (mime.startsWith("video/")) {
        hasVideo = true
        continue
      }
      if (!mime.startsWith("audio/")) continue
      val sampleRate = format.int(MediaFormat.KEY_SAMPLE_RATE) ?: 0
      val channels = format.int(MediaFormat.KEY_CHANNEL_COUNT) ?: 0
      val duration = format.long(MediaFormat.KEY_DURATION) ?: 0L
      val aacObjectType = if (mime == MIME_AAC) AacCodecData.objectType(format) else null
      val aacProfile = aacObjectType?.let(AacCodecData::profile)
      val pcmBits = if (mime in PCM_MIMES || mime in FLAC_MIMES) pcmBits(format) else null
      onDecoderCheck()
      candidates += AudioTrackCandidate(
        index = index,
        format = format,
        mime = mime,
        durationUs = duration,
        sampleRateHz = sampleRate,
        channelCount = channels,
        encodedBitrateBps = format.long(MediaFormat.KEY_BIT_RATE)?.takeIf { it > 0L },
        pcmBitsPerSample = pcmBits,
        aacProfile = aacProfile,
        aacObjectType = aacObjectType,
        codecConfigFingerprint = if (mime == MIME_AAC && aacObjectType != null) {
          AacCodecData.fingerprint(format, mime, sampleRate, channels, aacObjectType)
        } else {
          null
        },
        encoderDelayFrames = format.long(MediaFormat.KEY_ENCODER_DELAY)?.takeIf { it >= 0L },
        encoderPaddingFrames = format.long(MediaFormat.KEY_ENCODER_PADDING)?.takeIf { it >= 0L },
        encrypted = format.int("is-encrypted") == 1 || format.int("crypto-mode") != null,
        // Android's standalone FLAC extractor exposes decoded PCM as audio/raw.
        // The fLaC signature keeps this distinct from ordinary WAV/PCM input.
        decoderAvailable =
          (mime == "audio/raw" && probe.isFlac) || decoderAvailability.hasDecoder(format)
      )
    }
    return candidates to hasVideo
  }

  fun select(
    candidates: List<AudioTrackCandidate>,
    hasVideo: Boolean,
    probe: ContainerProbe,
    extractorHasDrm: Boolean
  ): SelectedAudioTrack {
    if (extractorHasDrm || candidates.any(AudioTrackCandidate::encrypted)) {
      throw mediaError(SnapCutMediaError.DRM_UNSUPPORTED)
    }
    if (candidates.isEmpty()) throw mediaError(SnapCutMediaError.NO_AUDIO_TRACK)

    val recognized = candidates.filter { candidate ->
      candidate.mime == MIME_AAC ||
        candidate.mime in MP3_MIMES ||
        candidate.mime in FLAC_MIMES ||
        (candidate.mime == "audio/raw" && probe.isFlac) ||
        (candidate.mime in PCM_MIMES && probe.isWave)
    }
    if (recognized.isEmpty()) throw mediaError(SnapCutMediaError.UNSUPPORTED_AUDIO_CODEC)
    val channelCompatible = recognized.filter { it.channelCount == 1 || it.channelCount == 2 }
    if (channelCompatible.isEmpty()) throw mediaError(SnapCutMediaError.UNSUPPORTED_CHANNEL_COUNT)
    val validMetadata = channelCompatible.filter {
      it.durationUs > 0L && it.sampleRateHz > 0
    }
    if (validMetadata.isEmpty()) throw mediaError(SnapCutMediaError.CORRUPT_MEDIA)
    val profileCompatible = validMetadata.filter {
      it.mime != MIME_AAC || it.aacProfile != null
    }
    if (profileCompatible.isEmpty()) throw mediaError(SnapCutMediaError.UNSUPPORTED_AUDIO_CODEC)
    val decodable = profileCompatible.firstOrNull(AudioTrackCandidate::decoderAvailable)
      ?: throw mediaError(SnapCutMediaError.UNSUPPORTED_AUDIO_CODEC)
    // The import copier can extract AAC from an ISO-BMFF video container. Other
    // codecs need a dedicated extraction/transcode path; copying their provider
    // bytes would incorrectly persist the complete video as an audio source.
    if (hasVideo && decodable.mime != MIME_AAC) {
      throw mediaError(SnapCutMediaError.UNSUPPORTED_AUDIO_CODEC)
    }
    if (
      decodable.mime in PCM_MIMES &&
      !probe.isFlac &&
      decodable.pcmBitsPerSample !in setOf(8, 16, 24, 32)
    ) {
      throw mediaError(SnapCutMediaError.UNSUPPORTED_AUDIO_CODEC)
    }

    val kind = when {
      decodable.mime == MIME_AAC && hasVideo -> SourceKind.VIDEO_EXTRACTED_AAC
      decodable.mime == MIME_AAC && probe.isFragmentedMp4 -> SourceKind.M4S_AAC
      decodable.mime == MIME_AAC -> SourceKind.M4A
      decodable.mime in MP3_MIMES -> SourceKind.MP3
      decodable.mime in FLAC_MIMES || (decodable.mime == "audio/raw" && probe.isFlac) -> SourceKind.FLAC
      else -> SourceKind.WAV
    }
    return SelectedAudioTrack(decodable, kind)
  }

  private fun pcmBits(format: MediaFormat): Int? {
    format.int("bits-per-sample")?.takeIf { it in setOf(8, 16, 24, 32) }?.let { return it }
    return when (format.int(MediaFormat.KEY_PCM_ENCODING)) {
      AudioFormat.ENCODING_PCM_8BIT -> 8
      AudioFormat.ENCODING_PCM_16BIT -> 16
      AudioFormat.ENCODING_PCM_24BIT_PACKED -> 24
      AudioFormat.ENCODING_PCM_32BIT -> 32
      else -> null
    }
  }

  private fun MediaFormat.int(key: String): Int? =
    if (!containsKey(key)) null else runCatching { getInteger(key) }.getOrNull()

  private fun MediaFormat.long(key: String): Long? = if (!containsKey(key)) {
    null
  } else {
    runCatching { getLong(key) }.getOrNull()
      ?: runCatching { getInteger(key).toLong() }.getOrNull()
  }

  private fun MediaFormat.string(key: String): String? =
    if (!containsKey(key)) null else runCatching { getString(key) }.getOrNull()
}

internal object AacCodecData {
  fun objectType(format: MediaFormat): Int? {
    if (format.containsKey(MediaFormat.KEY_AAC_PROFILE)) {
      runCatching { format.getInteger(MediaFormat.KEY_AAC_PROFILE) }
        .getOrNull()
        ?.takeIf { it > 0 }
        ?.let { return it }
    }
    val csd = if (format.containsKey("csd-0")) runCatching { format.getByteBuffer("csd-0") }.getOrNull() else null
    return csd?.let(::objectTypeFromAudioSpecificConfig)
  }

  fun profile(objectType: Int): AacProfile? = when (objectType) {
    MediaCodecInfo.CodecProfileLevel.AACObjectLC -> AacProfile.AAC_LC
    MediaCodecInfo.CodecProfileLevel.AACObjectHE -> AacProfile.HE_AAC_V1
    MediaCodecInfo.CodecProfileLevel.AACObjectHE_PS -> AacProfile.HE_AAC_V2
    else -> null
  }

  fun objectTypeFromAudioSpecificConfig(buffer: ByteBuffer): Int? {
    val bytes = buffer.duplicate().run {
      position(0)
      ByteArray(remaining()).also(::get)
    }
    if (bytes.isEmpty()) return null
    val first = (bytes[0].toInt() ushr 3) and 0x1f
    if (first != 31) return first
    if (bytes.size < 2) return null
    return 32 + (((bytes[0].toInt() and 0x07) shl 3) or ((bytes[1].toInt() ushr 5) and 0x07))
  }

  fun fingerprint(
    format: MediaFormat,
    mime: String,
    sampleRateHz: Int,
    channelCount: Int,
    objectType: Int
  ): String {
    val digest = MessageDigest.getInstance("SHA-256")
    updateLengthPrefixed(digest, mime.toByteArray(Charsets.UTF_8))
    listOf(sampleRateHz, channelCount, objectType).forEach { value ->
      updateLengthPrefixed(
        digest,
        byteArrayOf(
          (value ushr 24).toByte(),
          (value ushr 16).toByte(),
          (value ushr 8).toByte(),
          value.toByte()
        )
      )
    }
    var index = 0
    while (format.containsKey("csd-$index")) {
      val buffer = runCatching { format.getByteBuffer("csd-$index") }.getOrNull() ?: break
      val bytes = buffer.duplicate().run {
        position(0)
        ByteArray(remaining()).also(::get)
      }
      updateLengthPrefixed(digest, bytes)
      index++
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun updateLengthPrefixed(digest: MessageDigest, value: ByteArray) {
    val length = value.size
    digest.update(
      byteArrayOf(
        (length ushr 24).toByte(),
        (length ushr 16).toByte(),
        (length ushr 8).toByte(),
        length.toByte()
      )
    )
    digest.update(value)
  }
}
