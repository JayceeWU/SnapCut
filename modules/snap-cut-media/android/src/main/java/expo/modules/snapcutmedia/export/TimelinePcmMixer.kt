package expo.modules.snapcutmedia.export

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.exportmedia.ResolvedExportClip
import expo.modules.snapcutmedia.models.TrackId
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.timeline.TimelineAudio
import java.io.Closeable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Streams at most two independently decoded tracks into one encoder. Each
 * producer is bounded to four PCM chunks; no track or full composition PCM is
 * retained in memory.
 */
internal class TimelinePcmMixer(
  private val decoderFactory: () -> DecodedClipDecoder = ::DecodedClipDecoder,
  private val resamplerFactory: (MediaResourceHooks) -> StatefulResamplerFactory =
    ::NativeStatefulResamplerFactory
) {
  fun mix(
    clips: List<ResolvedExportClip>,
    descriptors: Map<String, DecodedSourceDescriptor>,
    outputRateHz: Int,
    outputChannels: Int,
    cancellation: CancellationCheck,
    hooks: MediaResourceHooks,
    sink: FloatPcmSink,
    progress: (Double) -> Unit = {}
  ): Long {
    require(clips.isNotEmpty() && outputChannels in 1..2)
    val totalDurationMs = clips.maxOf(ResolvedExportClip::timelineEndMs)
    val totalFrames = timelineFrame(totalDurationMs, outputRateHz)
    if (totalFrames <= 0L) throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    val producers = TrackId.entries.mapNotNull { trackId ->
      clips.filter { it.trackId == trackId }
        .takeIf(List<ResolvedExportClip>::isNotEmpty)
        ?.let { trackClips ->
          TrackProducer(
            trackId,
            trackClips,
            descriptors,
            totalFrames,
            outputRateHz,
            outputChannels,
            decoderFactory(),
            resamplerFactory,
            cancellation,
            hooks
          )
        }
    }
    if (producers.isEmpty() || producers.size > 2) {
      throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
    }
    var writtenFrames = 0L
    try {
      producers.forEach(TrackProducer::start)
      while (writtenFrames < totalFrames) {
        cancellation.throwIfCancelled()
        val frames = minOf(MAX_MIX_FRAMES.toLong(), totalFrames - writtenFrames).toInt()
        val first = producers[0].readExact(frames)
        val mixed = if (producers.size == 1) {
          TimelineAudio.hardClamp(first)
        } else {
          TimelineAudio.mixHardClamped(first, producers[1].readExact(frames))
        }
        sink.write(mixed, frames)
        writtenFrames = Math.addExact(writtenFrames, frames.toLong())
        progress(writtenFrames.toDouble() / totalFrames.toDouble())
      }
      producers.forEach(TrackProducer::requireFinished)
      return writtenFrames
    } finally {
      var closeFailure: Throwable? = null
      producers.forEach { producer ->
        try {
          producer.close()
        } catch (error: Throwable) {
          if (closeFailure == null) closeFailure = error
        }
      }
      closeFailure?.let { throw it }
    }
  }

  private class TrackProducer(
    private val trackId: TrackId,
    private val clips: List<ResolvedExportClip>,
    private val descriptors: Map<String, DecodedSourceDescriptor>,
    private val totalFrames: Long,
    private val outputRateHz: Int,
    private val outputChannels: Int,
    private val decoder: DecodedClipDecoder,
    private val resamplerFactory: (MediaResourceHooks) -> StatefulResamplerFactory,
    private val cancellation: CancellationCheck,
    private val hooks: MediaResourceHooks
  ) : Closeable {
    private sealed interface Packet {
      data class Pcm(val samples: FloatArray, val frames: Int) : Packet
      data class Failed(val error: Throwable) : Packet
      data object End : Packet
    }

    private val stopped = AtomicBoolean(false)
    private val trackHooks = TrackResourceHooks(hooks)
    private val queue = ArrayBlockingQueue<Packet>(QUEUE_CAPACITY)
    private val thread = Thread(::produce, "SnapCut-${trackId.value}-decoder")
    private val producerCancellation = StopAwareCancellation(cancellation, stopped)
    private var current: Packet.Pcm? = null
    private var currentFrameOffset = 0
    private var reachedEnd = false

    fun start() = thread.start()

    fun readExact(frameCount: Int): FloatArray {
      if (frameCount <= 0 || reachedEnd) throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      val result = FloatArray(frameCount * outputChannels)
      var copied = 0
      while (copied < frameCount) {
        cancellation.throwIfCancelled()
        val packet = current ?: nextPcm().also {
          current = it
          currentFrameOffset = 0
        }
        val available = packet.frames - currentFrameOffset
        val count = minOf(available, frameCount - copied)
        val sourceOffset = currentFrameOffset * outputChannels
        packet.samples.copyInto(
          result,
          destinationOffset = copied * outputChannels,
          startIndex = sourceOffset,
          endIndex = sourceOffset + count * outputChannels
        )
        copied += count
        currentFrameOffset += count
        if (currentFrameOffset == packet.frames) current = null
      }
      return result
    }

    fun requireFinished() {
      if (current != null) throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      when (val packet = takePacket()) {
        Packet.End -> reachedEnd = true
        is Packet.Failed -> throw packet.error
        is Packet.Pcm -> throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      }
    }

    override fun close() {
      if (!stopped.compareAndSet(false, true)) return
      trackHooks.cancelActive()
      thread.interrupt()
      requireThreadStopped(thread, THREAD_JOIN_TIMEOUT_MS)
      queue.clear()
    }

    private fun nextPcm(): Packet.Pcm = when (val packet = takePacket()) {
      is Packet.Pcm -> packet
      is Packet.Failed -> throw packet.error
      Packet.End -> {
        reachedEnd = true
        throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
      }
    }

    private fun takePacket(): Packet {
      while (true) {
        cancellation.throwIfCancelled()
        try {
          queue.poll(QUEUE_WAIT_MS, TimeUnit.MILLISECONDS)?.let { return it }
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
          throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
        }
      }
    }

    private fun produce() {
      try {
        var timelineCursor = 0L
        clips.forEach { clip ->
          producerCancellation.throwIfCancelled()
          val clipStartFrame = timelineFrame(clip.timelineStartMs, outputRateHz)
          val clipEndFrame = timelineFrame(clip.timelineEndMs, outputRateHz)
          if (clipStartFrame < timelineCursor || clipEndFrame <= clipStartFrame) {
            throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
          }
          emitSilence(clipStartFrame - timelineCursor)
          val targetClipFrames = clipEndFrame - clipStartFrame
          var emittedClipFrames = 0L
          var clipOpen = false
          ClipPcmTransformer(
            outputRate = outputRateHz,
            outputChannels = outputChannels,
            resamplerFactory = resamplerFactory(trackHooks),
            sink = FloatPcmSink { samples, frames ->
              val remaining = targetClipFrames - emittedClipFrames
              if (remaining <= 0L) return@FloatPcmSink
              val acceptedFrames = minOf(frames.toLong(), remaining).toInt()
              val accepted = if (acceptedFrames == frames) {
                samples
              } else {
                samples.copyOf(acceptedFrames * outputChannels)
              }
              TimelineAudio.applyGainAndFades(
                accepted,
                outputChannels,
                emittedClipFrames,
                outputRateHz,
                clip.durationMs,
                clip.gain,
                clip.fadeInMs,
                clip.fadeOutMs
              )
              emit(accepted, acceptedFrames)
              emittedClipFrames += acceptedFrames
            }
          ).use { transformer ->
            decoder.decode(
              clip = clip,
              descriptor = descriptors.getValue(clip.file.path),
              cancellation = producerCancellation,
              hooks = trackHooks,
              onFormat = { format ->
                if (clipOpen) throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
                transformer.beginClip(format.sampleRateHz, format.channelCount)
                clipOpen = true
              },
              onPcm = transformer::write
            )
            if (!clipOpen) throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED)
            transformer.finishClip()
          }
          emitSilence(targetClipFrames - emittedClipFrames)
          timelineCursor = clipEndFrame
        }
        emitSilence(totalFrames - timelineCursor)
        put(Packet.End)
      } catch (error: Throwable) {
        if (!stopped.get()) {
          queue.clear()
          runCatching { put(Packet.Failed(error)) }
        }
      }
    }

    private fun emitSilence(frameCount: Long) {
      var remaining = frameCount
      while (remaining > 0L) {
        producerCancellation.throwIfCancelled()
        val frames = minOf(MAX_MIX_FRAMES.toLong(), remaining).toInt()
        emit(FloatArray(frames * outputChannels), frames)
        remaining -= frames
      }
    }

    private fun emit(samples: FloatArray, frames: Int) {
      if (frames <= 0) return
      require(samples.size == frames * outputChannels)
      put(Packet.Pcm(samples, frames))
    }

    private fun put(packet: Packet) {
      while (!stopped.get()) {
        producerCancellation.throwIfCancelled()
        try {
          if (queue.offer(packet, QUEUE_WAIT_MS, TimeUnit.MILLISECONDS)) return
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
          throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
        }
      }
      throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
    }
  }

  companion object {
    internal fun timelineFrame(positionMs: Long, sampleRateHz: Int): Long = when {
      positionMs == 0L -> 0L
      positionMs > 0L -> ClipFrameMath.durationFrames(positionMs, sampleRateHz)
      else -> throw mediaError(SnapCutMediaError.INVALID_CLIP_RANGE)
    }

    private const val MAX_MIX_FRAMES = ClipPcmTransformer.MAX_PCM_CHUNK_FRAMES
    private const val QUEUE_CAPACITY = 4
    private const val QUEUE_WAIT_MS = 50L
    private const val THREAD_JOIN_TIMEOUT_MS = 2_000L
  }
}

internal class StopAwareCancellation(
  private val upstream: CancellationCheck,
  private val stopped: AtomicBoolean
) : CancellationCheck {
  override fun throwIfCancelled() {
    upstream.throwIfCancelled()
    if (stopped.get() || Thread.currentThread().isInterrupted) {
      throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
    }
  }
}

internal class TrackResourceHooks(
  private val delegate: MediaResourceHooks
) : MediaResourceHooks {
  private val lock = Any()
  private val resources = linkedSetOf<NativeJobResource>()
  private var cancelled = false

  override fun attach(resource: NativeJobResource) {
    synchronized(lock) {
      if (cancelled) throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
      delegate.attach(resource)
      resources += resource
    }
  }

  override fun detach(resource: NativeJobResource) {
    val attached = synchronized(lock) { resources.remove(resource) }
    if (attached) delegate.detach(resource)
  }

  fun cancelActive() {
    val active = synchronized(lock) {
      cancelled = true
      resources.toList()
    }
    active.forEach { resource -> runCatching(resource::cancel) }
  }
}

internal fun requireThreadStopped(thread: Thread, timeoutMs: Long) {
  try {
    thread.join(timeoutMs)
  } catch (_: InterruptedException) {
    Thread.currentThread().interrupt()
    throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
  }
  if (thread.isAlive) {
    throw mediaError(SnapCutMediaError.EXPORT_DECODE_FAILED, "decoder-thread-timeout")
  }
}
