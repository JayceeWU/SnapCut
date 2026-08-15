package expo.modules.snapcutmedia.preview

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import expo.modules.snapcutmedia.timeline.TimelineAudio
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/** Applies the same clip gain and equal-power envelope used by export. */
internal class PreviewEnvelopeAudioProcessor(
  clips: List<PreviewClip>
) : BaseAudioProcessor() {
  @Volatile
  private var schedule = clips.sortedBy(PreviewClip::timelineStartMs)
  private val clock = PreviewEnvelopeClock()
  private var scheduleCursor = 0

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (
      inputAudioFormat.encoding != C.ENCODING_PCM_16BIT &&
      inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT
    ) {
      throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
    }
    return inputAudioFormat
  }

  /** Applies an absolute composition anchor only when Media3 flushes for the seek. */
  fun requestSeekPositionMs(positionMs: Long) {
    clock.requestSeekPositionMs(positionMs)
  }

  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
    // Media3's stream offset belongs to the current media period and is not a reliable
    // composition coordinate across clipped/silence playlist items. The controller updates
    // the explicit seek anchor when present. Natural playlist transitions happen before the
    // main-thread Player.Listener callback, so they advance using PCM already consumed by this
    // processor instead of waiting for UI-thread item events.
    clock.flush(inputAudioFormat.sampleRate)
    scheduleCursor = firstCandidate(clock.positionUs(0, inputAudioFormat.sampleRate) / 1_000.0)
  }

  override fun onReset() {
    clock.reset()
    scheduleCursor = 0
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    if (!inputBuffer.hasRemaining()) return
    val output = replaceOutputBuffer(inputBuffer.remaining()).order(ByteOrder.LITTLE_ENDIAN)
    val input = inputBuffer.order(ByteOrder.LITTLE_ENDIAN)
    val bytesPerSample = if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) 4 else 2
    val frameBytes = Math.multiplyExact(bytesPerSample, inputAudioFormat.channelCount)
    require(input.remaining() % frameBytes == 0)
    val frames = input.remaining() / frameBytes
    repeat(frames) { frame ->
      val positionUs = clock.positionUs(frame.toLong(), inputAudioFormat.sampleRate)
      val multiplier = multiplierAt(positionUs / 1_000.0)
      repeat(inputAudioFormat.channelCount) {
        if (bytesPerSample == 4) {
          val value = input.float
          output.putFloat(((if (value.isFinite()) value else 0f) * multiplier).toFloat())
        } else {
          val value = input.short.toInt()
          output.putShort(
            (value * multiplier).roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
              .toShort()
          )
        }
      }
    }
    clock.advance(frames.toLong())
    inputBuffer.position(inputBuffer.limit())
    output.flip()
  }

  private fun multiplierAt(positionMs: Double): Double {
    while (scheduleCursor < schedule.size && positionMs >= schedule[scheduleCursor].timelineEndMs) {
      scheduleCursor += 1
    }
    val clip = schedule.getOrNull(scheduleCursor) ?: return 0.0
    if (positionMs < clip.timelineStartMs) return 0.0
    val localPosition = positionMs - clip.timelineStartMs
    return clip.gain * TimelineAudio.envelope(
      localPosition,
      clip.durationMs,
      clip.fadeInMs,
      clip.fadeOutMs
    )
  }

  private fun firstCandidate(positionMs: Double): Int {
    var low = 0
    var high = schedule.size
    while (low < high) {
      val middle = (low + high) ushr 1
      if (schedule[middle].timelineEndMs <= positionMs) low = middle + 1 else high = middle
    }
    return low
  }

}
