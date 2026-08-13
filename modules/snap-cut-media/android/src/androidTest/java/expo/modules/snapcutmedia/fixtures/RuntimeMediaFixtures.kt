package expo.modules.snapcutmedia.fixtures

import expo.modules.snapcutmedia.export.CompositionEncoderConfig
import expo.modules.snapcutmedia.export.NativeCompositionEncoderFactory
import expo.modules.snapcutmedia.models.ExportFormat
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin

/** Small deterministic fixtures generated in the test APK; no provider bytes enter JavaScript. */
internal object RuntimeMediaFixtures {
  private const val WAV_SAMPLE_RATE_HZ = 44_100
  private const val WAV_DURATION_MS = 250

  val pcmWav: ByteArray by lazy {
    val sampleCount = WAV_SAMPLE_RATE_HZ * WAV_DURATION_MS / 1_000
    val dataSize = sampleCount * 2
    ByteBuffer.allocate(44 + dataSize)
      .order(ByteOrder.LITTLE_ENDIAN)
      .apply {
        put("RIFF".toByteArray(Charsets.US_ASCII))
        putInt(36 + dataSize)
        put("WAVE".toByteArray(Charsets.US_ASCII))
        put("fmt ".toByteArray(Charsets.US_ASCII))
        putInt(16)
        putShort(1.toShort())
        putShort(1.toShort())
        putInt(WAV_SAMPLE_RATE_HZ)
        putInt(WAV_SAMPLE_RATE_HZ * 2)
        putShort(2.toShort())
        putShort(16.toShort())
        put("data".toByteArray(Charsets.US_ASCII))
        putInt(dataSize)
        repeat(sampleCount) { index ->
          val value = sin(2.0 * PI * 440.0 * index / WAV_SAMPLE_RATE_HZ)
          putShort((value * 8_192.0).toInt().toShort())
        }
      }
      .array()
  }

  /**
   * Structurally valid ISO-BMFF media fragment: styp + moof(mfhd/traf/tfhd/tfdt/trun) + mdat.
   * It intentionally has no moov/init segment. The four-byte sample payload is not presented as a
   * codec-valid AAC fixture; this exercises deterministic missing-init classification only.
   */
  val fragmentWithoutInitialization: ByteArray by lazy {
    val mfhd = fullBox("mfhd", versionAndFlags = 0, intBytes(1))
    val tfhd = fullBox("tfhd", versionAndFlags = 0x0002_0000, intBytes(1))
    val tfdt = fullBox("tfdt", versionAndFlags = 0x0100_0000, longBytes(0L))
    val trunPayload = intBytes(1) + intBytes(104) + intBytes(1_024) + intBytes(4)
    val trun = fullBox("trun", versionAndFlags = 0x0000_0301, trunPayload)
    val moof = box("moof", mfhd + box("traf", tfhd + tfdt + trun))
    val stypPayload = ascii("msdh") + intBytes(0) + ascii("msdh") + ascii("msix")
    box("styp", stypPayload) + moof + box("mdat", byteArrayOf(0x21, 0x10, 0x04, 0x60))
  }

  /**
   * Generates a codec-valid MP3 with the pinned production LAME bridge at test runtime. The
   * provider deliberately reports this byte stream as a `.m4s` file with an unrelated MIME.
   */
  fun legalMp3(cacheRoot: File): ByteArray = synchronized(MP3_LOCK) {
    val fixtureRoot = File(cacheRoot, "snapcut-runtime-media")
    check(fixtureRoot.exists() || fixtureRoot.mkdirs())
    val fixture = File(fixtureRoot, "generated-tone.mp3")
    if (!fixture.isFile || fixture.length() == 0L) {
      val partial = File(fixtureRoot, "generated-tone.mp3.partial")
      if (partial.exists()) check(partial.delete())
      val frames = WAV_SAMPLE_RATE_HZ * WAV_DURATION_MS / 1_000
      val encoder = NativeCompositionEncoderFactory().create(
        CompositionEncoderConfig(
          format = ExportFormat.MP3,
          outputFile = partial,
          sampleRateHz = WAV_SAMPLE_RATE_HZ,
          channelCount = 1,
          totalFrames = frames.toLong(),
          title = "SnapCut connected-test tone"
        )
      )
      encoder.use {
        var frameOffset = 0
        while (frameOffset < frames) {
          val frameCount = minOf(MP3_CHUNK_FRAMES, frames - frameOffset)
          val pcm = FloatArray(frameCount) { localFrame ->
            val frame = frameOffset + localFrame
            (sin(2.0 * PI * 440.0 * frame / WAV_SAMPLE_RATE_HZ) * 0.25).toFloat()
          }
          encoder.write(pcm, frameCount)
          frameOffset += frameCount
        }
        encoder.finish()
      }
      check(partial.isFile && partial.length() > 0L)
      if (fixture.exists()) check(fixture.delete())
      check(partial.renameTo(fixture))
    }
    fixture.readBytes()
  }

  fun patternBytes(size: Int): ByteArray {
    require(size in 1..MAX_PATTERN_BYTES)
    return ByteArray(size) { index -> (index * 31 + 17).toByte() }
  }

  private fun fullBox(type: String, versionAndFlags: Int, payload: ByteArray): ByteArray =
    box(type, intBytes(versionAndFlags) + payload)

  private fun box(type: String, payload: ByteArray): ByteArray {
    require(type.length == 4)
    val bytes = ByteArrayOutputStream(8 + payload.size)
    DataOutputStream(bytes).use { output ->
      output.writeInt(8 + payload.size)
      output.write(ascii(type))
      output.write(payload)
    }
    return bytes.toByteArray()
  }

  private fun intBytes(value: Int): ByteArray = ByteBuffer.allocate(Int.SIZE_BYTES)
    .order(ByteOrder.BIG_ENDIAN)
    .putInt(value)
    .array()

  private fun longBytes(value: Long): ByteArray = ByteBuffer.allocate(Long.SIZE_BYTES)
    .order(ByteOrder.BIG_ENDIAN)
    .putLong(value)
    .array()

  private fun ascii(value: String): ByteArray = value.toByteArray(Charsets.US_ASCII)

  private val MP3_LOCK = Any()
  private const val MP3_CHUNK_FRAMES = 4_096
  private const val MAX_PATTERN_BYTES = 2 * 1024 * 1024
}
