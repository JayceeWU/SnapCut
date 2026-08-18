package expo.modules.snapcutmedia.exportmedia

import java.math.BigInteger

internal object ExportMath {
  private val LONG_MAX = BigInteger.valueOf(Long.MAX_VALUE)
  // BigInteger.TWO was added in Java 9 but is absent from Android 29's
  // java.math.BigInteger. Keep this boundary compatible with minSdk 29.
  private val TWO = BigInteger.valueOf(2L)
  private val ONE_HUNDRED = BigInteger.valueOf(100L)

  fun outputSampleRate(sampleRates: Collection<Int>): Int {
    require(sampleRates.isNotEmpty())
    val first = sampleRates.first()
    if (sampleRates.all { it == first } && first in SUPPORTED_OUTPUT_RATES) return first
    return if (sampleRates.any { it >= 48_000 }) 48_000 else 44_100
  }

  fun outputChannelCount(channelCounts: Collection<Int>): Int {
    require(channelCounts.isNotEmpty() && channelCounts.all { it in 1..2 })
    return if (channelCounts.any { it == 2 }) 2 else 1
  }

  fun estimateM4aBytes(payloadBytes: Long): Long {
    require(payloadBytes > 0L)
    val percentage = ceilDivide(BigInteger.valueOf(payloadBytes).multiply(TWO), ONE_HUNDRED)
    val overhead = percentage.max(BigInteger.valueOf(M4A_MINIMUM_OVERHEAD_BYTES))
    return capped(BigInteger.valueOf(payloadBytes).add(overhead))
  }

  fun estimateMp3Bytes(durationMs: Long): Long {
    require(durationMs > 0L)
    val payload = BigInteger.valueOf(durationMs).multiply(BigInteger.valueOf(40L))
    return capped(payload.add(BigInteger.valueOf(MP3_METADATA_OVERHEAD_BYTES)))
  }

  fun estimateAacBytes(durationMs: Long, channelCount: Int): Long {
    require(durationMs > 0L && channelCount in 1..2)
    val bitrateBps = if (channelCount == 1) 160_000L else 320_000L
    val payload = ceilDivide(
      BigInteger.valueOf(durationMs).multiply(BigInteger.valueOf(bitrateBps)),
      BigInteger.valueOf(8_000L)
    )
    return capped(payload.add(BigInteger.valueOf(M4A_MINIMUM_OVERHEAD_BYTES)))
  }

  fun requiredFreeBytes(estimatedOutputBytes: Long): Long {
    require(estimatedOutputBytes > 0L)
    val doubledWithSafety = ceilDivide(
      BigInteger.valueOf(estimatedOutputBytes).multiply(BigInteger.valueOf(22L)),
      BigInteger.TEN
    )
    return capped(doubledWithSafety.add(BigInteger.valueOf(WORKING_MARGIN_BYTES)))
  }

  fun safeDurationSum(rangesMs: Collection<Long>): Long {
    require(rangesMs.isNotEmpty() && rangesMs.all { it > 0L })
    return capped(rangesMs.fold(BigInteger.ZERO) { total, value ->
      total.add(BigInteger.valueOf(value))
    })
  }

  private fun ceilDivide(value: BigInteger, divisor: BigInteger): BigInteger =
    value.add(divisor).subtract(BigInteger.ONE).divide(divisor)

  private fun capped(value: BigInteger): Long = value.min(LONG_MAX).toLong()

  private val SUPPORTED_OUTPUT_RATES = setOf(32_000, 44_100, 48_000)
  private const val M4A_MINIMUM_OVERHEAD_BYTES = 64L * 1024L
  private const val MP3_METADATA_OVERHEAD_BYTES = 64L * 1024L
  const val WORKING_MARGIN_BYTES = 16L * 1024L * 1024L
}
