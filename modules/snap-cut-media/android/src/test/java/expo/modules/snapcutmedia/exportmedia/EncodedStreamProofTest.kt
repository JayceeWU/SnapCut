package expo.modules.snapcutmedia.exportmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer

class EncodedStreamProofTest {
  @Test
  fun `payload proof preserves flags access-unit boundaries and exact AAC bytes`() {
    val baseline = proof(1 to byteArrayOf(1, 2), 0 to byteArrayOf(3))

    assertEquals(baseline, proof(1 to byteArrayOf(1, 2), 0 to byteArrayOf(3)))
    assertNotEquals(baseline, proof(0 to byteArrayOf(1, 2), 0 to byteArrayOf(3)))
    assertNotEquals(baseline, proof(1 to byteArrayOf(1), 0 to byteArrayOf(2, 3)))
    assertNotEquals(baseline, proof(1 to byteArrayOf(1, 2), 0 to byteArrayOf(4)))
  }

  @Test
  fun `nonzero source starts and multiple clips rewrite to one output timeline`() {
    val firstSourceStartUs = 5_000_000L
    val secondSourceStartUs = 9_000_000L

    assertEquals(0L, M4aOutputTimestamp.rewrite(0L, firstSourceStartUs, firstSourceStartUs))
    assertEquals(
      23_220L,
      M4aOutputTimestamp.rewrite(0L, firstSourceStartUs + 23_220L, firstSourceStartUs)
    )
    assertEquals(
      46_440L,
      M4aOutputTimestamp.rewrite(46_440L, secondSourceStartUs, secondSourceStartUs)
    )
  }

  @Test
  fun `timeline accepts plus or minus one microsecond MP4 rounding per access unit`() {
    verifyTimeline(
      expected = longArrayOf(0L, 23_220L, 46_440L, 69_660L),
      actual = longArrayOf(1L, 23_219L, 46_441L, 69_659L),
      sampleRateHz = 44_100
    )
  }

  @Test
  fun `timeline rejects rounding beyond one MP4 sample-rate timebase tick`() {
    val toleranceUs = M4aTimelinePolicy.timebaseToleranceUs(44_100)

    assertThrows(IllegalArgumentException::class.java) {
      verifyTimeline(
        expected = longArrayOf(0L, 23_220L),
        actual = longArrayOf(toleranceUs + 1L, 23_220L),
        sampleRateHz = 44_100
      )
    }
  }

  @Test
  fun `encoded buffer grows only to required size under hard safety limit`() {
    val adaptive = AdaptiveEncodedBuffer(initialCapacity = 4, maximumCapacity = 8)

    assertEquals(4, adaptive.requireCapacity(4).capacity())
    assertEquals(8, adaptive.requireCapacity(8).capacity())
    assertThrows(IllegalArgumentException::class.java) { adaptive.requireCapacity(9) }
  }

  private fun proof(vararg accessUnits: Pair<Int, ByteArray>): EncodedStreamProof {
    val accumulator = EncodedStreamProofAccumulator()
    accessUnits.forEach { (flags, bytes) ->
      accumulator.add(flags, ByteBuffer.wrap(bytes), bytes.size)
    }
    return accumulator.finish()
  }

  private fun verifyTimeline(expected: LongArray, actual: LongArray, sampleRateHz: Int) {
    val file = File.createTempFile("snapcut-m4a-timeline-", ".proof")
    try {
      val proof = M4aTimelineProofWriter(file).use { writer ->
        expected.forEach(writer::add)
        writer.finish()
      }
      M4aTimelineProofReader(proof, sampleRateHz).use { reader ->
        actual.forEach(reader::add)
        reader.finish()
      }
    } finally {
      file.delete()
    }
  }
}
