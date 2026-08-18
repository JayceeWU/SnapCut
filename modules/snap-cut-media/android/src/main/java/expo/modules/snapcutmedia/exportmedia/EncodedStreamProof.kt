package expo.modules.snapcutmedia.exportmedia

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest

internal data class EncodedStreamProof(
  val sampleCount: Long,
  val payloadBytes: Long,
  val digest: String
)

/** Bounded rolling proof over access-unit flags, boundaries, and exact AAC payload bytes. */
internal class EncodedStreamProofAccumulator {
  private val digest = MessageDigest.getInstance("SHA-256")
  private var sampleCount = 0L
  private var payloadBytes = 0L

  fun add(flags: Int, data: ByteBuffer, size: Int) {
    require(size > 0 && size <= data.capacity())
    updateInt(flags)
    updateInt(size)
    val duplicate = data.duplicate().apply {
      position(0)
      limit(size)
    }
    val chunk = ByteArray(minOf(PROOF_CHUNK_BYTES, size))
    while (duplicate.hasRemaining()) {
      val count = minOf(chunk.size, duplicate.remaining())
      duplicate.get(chunk, 0, count)
      digest.update(chunk, 0, count)
    }
    sampleCount = Math.addExact(sampleCount, 1L)
    payloadBytes = Math.addExact(payloadBytes, size.toLong())
  }

  fun finish(): EncodedStreamProof {
    require(sampleCount > 0L && payloadBytes > 0L)
    return EncodedStreamProof(
      sampleCount,
      payloadBytes,
      digest.digest().joinToString("") { "%02x".format(it) }
    )
  }

  private fun updateInt(value: Int) {
    for (shift in 24 downTo 0 step 8) digest.update((value ushr shift).toByte())
  }

  private companion object {
    const val PROOF_CHUNK_BYTES = 64 * 1024
  }
}

internal object M4aOutputTimestamp {
  fun rewrite(outputBaseUs: Long, sourceTimestampUs: Long, effectiveStartUs: Long): Long {
    require(outputBaseUs >= 0L && sourceTimestampUs >= effectiveStartUs && effectiveStartUs >= 0L)
    return Math.addExact(outputBaseUs, sourceTimestampUs - effectiveStartUs)
  }
}

internal data class M4aTimelineProof(
  val file: File,
  val sampleCount: Long,
  val firstPresentationTimeUs: Long,
  val lastPresentationTimeUs: Long
)

/**
 * Writes the exact pre-mux presentation timeline to a bounded-memory sidecar. The sidecar stays in
 * the export staging directory and is removed with the job after verification.
 */
internal class M4aTimelineProofWriter(file: File) : Closeable {
  private val output = DataOutputStream(
    BufferedOutputStream(FileOutputStream(file), TIMELINE_BUFFER_BYTES)
  )
  private val proofFile = file
  private var sampleCount = 0L
  private var firstTimestampUs = -1L
  private var lastTimestampUs = -1L
  private var finished = false

  fun add(presentationTimeUs: Long) {
    check(!finished)
    require(presentationTimeUs >= 0L)
    if (lastTimestampUs >= 0L) require(presentationTimeUs > lastTimestampUs)
    output.writeLong(presentationTimeUs)
    if (firstTimestampUs < 0L) firstTimestampUs = presentationTimeUs
    lastTimestampUs = presentationTimeUs
    sampleCount = Math.addExact(sampleCount, 1L)
  }

  fun finish(): M4aTimelineProof {
    check(!finished)
    require(sampleCount > 0L && firstTimestampUs >= 0L)
    output.flush()
    output.close()
    finished = true
    val expectedBytes = Math.multiplyExact(sampleCount, Long.SIZE_BYTES.toLong())
    require(proofFile.isFile && proofFile.length() == expectedBytes)
    return M4aTimelineProof(proofFile, sampleCount, firstTimestampUs, lastTimestampUs)
  }

  override fun close() {
    if (!finished) {
      runCatching(output::close)
      finished = true
    }
  }
}

internal data class VerifiedM4aTimeline(
  val firstPresentationTimeUs: Long,
  val lastPresentationTimeUs: Long
)

/**
 * Compares every post-mux timestamp with its exact pre-mux counterpart. MediaMuxer stores audio
 * time in an MP4 integer timebase, so one sample-rate timebase tick is the only allowed drift.
 */
internal class M4aTimelineProofReader(
  private val proof: M4aTimelineProof,
  sampleRateHz: Int
) : Closeable {
  private val input = DataInputStream(
    BufferedInputStream(FileInputStream(proof.file), TIMELINE_BUFFER_BYTES)
  )
  private val toleranceUs = M4aTimelinePolicy.timebaseToleranceUs(sampleRateHz)
  private var samplesRead = 0L
  private var firstActualTimestampUs = -1L
  private var lastActualTimestampUs = -1L
  private var finished = false

  init {
    require(proof.sampleCount > 0L)
    require(proof.firstPresentationTimeUs == 0L)
    require(proof.lastPresentationTimeUs >= proof.firstPresentationTimeUs)
    val expectedBytes = Math.multiplyExact(proof.sampleCount, Long.SIZE_BYTES.toLong())
    require(proof.file.isFile && proof.file.length() == expectedBytes)
  }

  fun add(actualPresentationTimeUs: Long) {
    check(!finished)
    require(actualPresentationTimeUs >= 0L)
    if (lastActualTimestampUs >= 0L) require(actualPresentationTimeUs > lastActualTimestampUs)
    val expectedPresentationTimeUs = try {
      input.readLong()
    } catch (error: EOFException) {
      throw IllegalArgumentException("M4A timeline contains more samples than expected", error)
    }
    require(
      M4aTimelinePolicy.isWithinTimebaseTolerance(
        expectedPresentationTimeUs,
        actualPresentationTimeUs,
        toleranceUs
      )
    )
    if (firstActualTimestampUs < 0L) firstActualTimestampUs = actualPresentationTimeUs
    lastActualTimestampUs = actualPresentationTimeUs
    samplesRead = Math.addExact(samplesRead, 1L)
  }

  fun finish(): VerifiedM4aTimeline {
    check(!finished)
    require(samplesRead == proof.sampleCount)
    require(input.read() == -1)
    input.close()
    finished = true
    return VerifiedM4aTimeline(firstActualTimestampUs, lastActualTimestampUs)
  }

  override fun close() {
    if (!finished) {
      runCatching(input::close)
      finished = true
    }
  }
}

internal object M4aTimelinePolicy {
  fun timebaseToleranceUs(sampleRateHz: Int): Long {
    require(sampleRateHz > 0)
    return (MICROSECONDS_PER_SECOND + sampleRateHz - 1L) / sampleRateHz
  }

  fun isWithinTimebaseTolerance(expectedUs: Long, actualUs: Long, toleranceUs: Long): Boolean {
    require(expectedUs >= 0L && actualUs >= 0L && toleranceUs >= 0L)
    val difference = if (actualUs >= expectedUs) actualUs - expectedUs else expectedUs - actualUs
    return difference <= toleranceUs
  }

  private const val MICROSECONDS_PER_SECOND = 1_000_000L
}

private const val TIMELINE_BUFFER_BYTES = 64 * 1024

internal class AdaptiveEncodedBuffer(
  initialCapacity: Int = INITIAL_CAPACITY_BYTES,
  private val maximumCapacity: Long = MAXIMUM_CAPACITY_BYTES
) {
  var buffer: ByteBuffer = ByteBuffer.allocateDirect(initialCapacity)
    private set

  init {
    require(initialCapacity > 0 && initialCapacity.toLong() <= maximumCapacity)
  }

  fun requireCapacity(sampleSize: Long): ByteBuffer {
    if (sampleSize <= 0L || sampleSize > maximumCapacity || sampleSize > Int.MAX_VALUE) {
      throw IllegalArgumentException("Encoded sample size is outside the bounded buffer policy")
    }
    if (sampleSize > buffer.capacity()) buffer = ByteBuffer.allocateDirect(sampleSize.toInt())
    buffer.clear()
    return buffer
  }

  companion object {
    const val INITIAL_CAPACITY_BYTES = 1024 * 1024
    const val MAXIMUM_CAPACITY_BYTES = 16L * 1024L * 1024L
  }
}
