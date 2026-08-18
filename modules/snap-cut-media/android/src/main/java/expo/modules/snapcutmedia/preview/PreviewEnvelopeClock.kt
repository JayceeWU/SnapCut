package expo.modules.snapcutmedia.preview

import java.util.concurrent.atomic.AtomicLong

/** Audio-thread timeline clock with a seek anchor consumed only on the next sink flush. */
internal class PreviewEnvelopeClock {
  private var timelineOffsetUs = 0L
  private var processedFrames = 0L
  private var activeSampleRateHz = 0
  private val pendingSeekOffsetUs = AtomicLong(NO_PENDING_SEEK)

  fun requestSeekPositionMs(positionMs: Long) {
    pendingSeekOffsetUs.set(Math.multiplyExact(positionMs.coerceAtLeast(0L), 1_000L))
  }

  fun flush(sampleRateHz: Int) {
    val requestedSeek = pendingSeekOffsetUs.getAndSet(NO_PENDING_SEEK)
    timelineOffsetUs = when {
      requestedSeek != NO_PENDING_SEEK -> requestedSeek
      activeSampleRateHz > 0 ->
        timelineOffsetUs + processedFrames * 1_000_000L / activeSampleRateHz
      else -> timelineOffsetUs
    }
    processedFrames = 0L
    activeSampleRateHz = sampleRateHz
  }

  fun positionUs(frameOffset: Long, sampleRateHz: Int): Long {
    require(frameOffset >= 0L && sampleRateHz > 0)
    require(activeSampleRateHz == sampleRateHz)
    return timelineOffsetUs + (processedFrames + frameOffset) * 1_000_000L / sampleRateHz
  }

  fun advance(frameCount: Long) {
    require(frameCount >= 0L)
    processedFrames = Math.addExact(processedFrames, frameCount)
  }

  fun reset() {
    timelineOffsetUs = 0L
    processedFrames = 0L
    pendingSeekOffsetUs.set(NO_PENDING_SEEK)
    activeSampleRateHz = 0
  }

  private companion object {
    const val NO_PENDING_SEEK = Long.MIN_VALUE
  }
}
