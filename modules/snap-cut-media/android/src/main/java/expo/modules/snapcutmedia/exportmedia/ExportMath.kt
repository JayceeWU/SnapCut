package expo.modules.snapcutmedia.exportmedia

import java.math.BigInteger

internal object ExportMath {
  private val LONG_MAX = BigInteger.valueOf(Long.MAX_VALUE)
  private val ONE_HUNDRED = BigInteger.valueOf(100L)
  private val ONE_THOUSAND = BigInteger.valueOf(1000L)

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
    val percentage = ceilDivide(BigInteger.valueOf(payloadBytes).multiply(BigInteger.TWO), ONE_HUNDRED)
    val overhead = percentage.max(BigInteger.valueOf(M4A_MINIMUM_OVERHEAD_BYTES))
    return capped(BigInteger.valueOf(payloadBytes).add(overhead))
  }

  fun estimateFlacBytes(durationMs: Long, sampleRateHz: Int, channelCount: Int): Long {
    require(durationMs > 0L && sampleRateHz > 0 && channelCount in 1..2)
    val raw = BigInteger.valueOf(durationMs)
      .multiply(BigInteger.valueOf(sampleRateHz.toLong()))
      .multiply(BigInteger.valueOf(channelCount.toLong()))
      .multiply(BigInteger.valueOf(3L))
    val rawBytes = ceilDivide(raw, ONE_THOUSAND)
    return capped(ceilDivide(rawBytes.multiply(BigInteger.valueOf(102L)), ONE_HUNDRED))
  }

  fun estimateMp3Bytes(durationMs: Long): Long {
    require(durationMs > 0L)
    val payload = BigInteger.valueOf(durationMs).multiply(BigInteger.valueOf(40L))
    return capped(payload.add(BigInteger.valueOf(MP3_METADATA_OVERHEAD_BYTES)))
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
