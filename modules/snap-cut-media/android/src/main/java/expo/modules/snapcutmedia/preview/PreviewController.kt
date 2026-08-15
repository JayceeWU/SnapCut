package expo.modules.snapcutmedia.preview

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.SilenceMediaSource
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.LoadPreviewRequest
import expo.modules.snapcutmedia.models.PreviewCommandRequest
import expo.modules.snapcutmedia.models.SeekPreviewRequest
import expo.modules.snapcutmedia.timeline.TimelineAudio
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.concurrent.CountDownLatch
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.abs

internal fun interface PreviewEventSink {
  fun emit(eventName: String, body: Map<String, Any?>)
}

/** Owns at most two synchronized native players, one per project track. */
internal class PreviewController(
  context: Context,
  private val eventSink: PreviewEventSink
) {
  private data class TrackPlayer(
    val timeline: PreviewTrackPlaylist,
    val processor: PreviewEnvelopeAudioProcessor,
    val player: ExoPlayer,
    val listener: Player.Listener
  )

  private data class ActivePreview(
    val token: PreviewSessionToken,
    val timeline: PreviewTimeline,
    val tracks: MutableList<TrackPlayer> = mutableListOf(),
    var prepared: Boolean = false,
    var completed: Boolean = false,
    var completionArmed: Boolean = false,
    var desiredPlaying: Boolean = false,
    var resumeAfterSeek: Boolean = false,
    var lastReportedPlaying: Boolean? = null,
    var nextSequence: Long = 1L
  )

  private data class PendingPrepare(
    val token: PreviewSessionToken,
    val expectedPlayers: Int,
    val readyPlayers: MutableSet<ExoPlayer>,
    val continuation: CancellableContinuation<Unit>
  )

  private val applicationContext = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  private val sourcePolicy = CommittedPreviewSource(applicationContext.filesDir)
  private val sessionGate = PreviewSessionGate()
  private val pauseCoordinator = PreviewPauseCoordinator()
  private val audioManager = applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val platformAudioAttributes = android.media.AudioAttributes.Builder()
    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
    .build()
  private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener(::onAudioFocusChange)
  private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
    .setAudioAttributes(platformAudioAttributes)
    .setWillPauseWhenDucked(true)
    .setOnAudioFocusChangeListener(audioFocusChangeListener, mainHandler)
    .build()

  private var active: ActivePreview? = null
  private var pendingPrepare: PendingPrepare? = null
  private var focusHeld = false
  private var noisyReceiverRegistered = false
  private var destroyed = false
  private var suppressPlayerEvents = false

  private val progressTicker = object : Runnable {
    override fun run() {
      val current = active ?: return
      val master = current.tracks.firstOrNull()?.player ?: return
      if (!master.isPlaying) return
      synchronizeFollowers(current)
      emitStatus("playing")
      mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS)
    }
  }

  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
        pauseForInterruption("route-disconnected")
      }
    }
  }

  suspend fun loadSelection(request: LoadPreviewRequest) = load(PreviewMode.SELECTION, request)

  suspend fun loadComposition(request: LoadPreviewRequest) = load(PreviewMode.COMPOSITION, request)

  suspend fun play(request: PreviewCommandRequest) = onMain {
    val current = requireActive(request)
    if (!sessionGate.acceptControl(current.token, request.controlRevision)) return@onMain
    current.desiredPlaying = true
    if (!current.prepared) throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
    if (audioManager.requestAudioFocus(focusRequest) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
    }
    focusHeld = true
    try {
      current.completed = false
      current.completionArmed = true
      if (current.tracks.any { it.player.playbackState == Player.STATE_ENDED }) {
        seekAll(current, 0L, resumeAfterReady = false)
      }
      current.tracks.asReversed().forEach { it.player.play() }
    } catch (error: Throwable) {
      current.completionArmed = false
      abandonAudioFocus()
      throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED, cause = error)
    }
  }

  suspend fun pause(request: PreviewCommandRequest) = onMain {
    val current = requireActive(request)
    if (!sessionGate.acceptControl(current.token, request.controlRevision)) return@onMain
    current.desiredPlaying = false
    pausePlayers("paused")
  }

  suspend fun seek(request: SeekPreviewRequest) = onMain {
    val current = requireActive(
      PreviewCommandRequest(
        request.playbackSessionId,
        request.generation,
        request.controlRevision
      )
    )
    if (!sessionGate.acceptControl(current.token, request.controlRevision)) return@onMain
    if (!current.prepared) throw mediaError(SnapCutMediaError.PREVIEW_SEEK_FAILED)
    try {
      current.completed = false
      current.desiredPlaying = request.resumeAfterSeek
      if (!request.resumeAfterSeek) pausePlayers("seek-paused", emit = false)
      seekAll(
        current,
        request.positionMs.coerceIn(0L, current.timeline.durationMs),
        resumeAfterReady = request.resumeAfterSeek
      )
      emitStatus("seek")
    } catch (error: Throwable) {
      throw mediaError(SnapCutMediaError.PREVIEW_SEEK_FAILED, cause = error)
    }
  }

  suspend fun release(request: PreviewCommandRequest): Boolean = onMain {
    val token = PreviewSessionToken(request.playbackSessionId, request.generation)
    if (!sessionGate.isCurrent(token)) return@onMain false
    if (!sessionGate.acceptControl(token, request.controlRevision)) return@onMain false
    releasePlayers()
    failPendingPrepare(mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED))
    sessionGate.release(token)
    active = null
    true
  }

  fun destroy() {
    if (Looper.myLooper() == Looper.getMainLooper()) return destroyOnMain()
    val completed = CountDownLatch(1)
    mainHandler.post {
      try {
        destroyOnMain()
      } finally {
        completed.countDown()
      }
    }
    completed.await()
  }

  private suspend fun load(mode: PreviewMode, request: LoadPreviewRequest) = onMain {
    checkNotDestroyed()
    val token = sessionGate.begin(
      request.playbackSessionId,
      request.generation,
      request.controlRevision
    )
      ?: throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    if (active?.token == token) return@onMain
    try {
      releasePlayers()
      failPendingPrepare(mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED))
      active = null

      if (mode == PreviewMode.COMPOSITION) TimelineAudio.validate(request.clips)
      val clips = request.clips.map { clip ->
        val file = sourcePolicy.requireCommittedFile(clip.audioFileUri, clip.sourceId)
        PreviewClip(
          clip.clipId,
          clip.sourceId,
          Uri.fromFile(file).toString(),
          clip.startMs,
          clip.endMs,
          clip.trackId,
          clip.timelineStartMs,
          clip.gain,
          clip.fadeInMs,
          clip.fadeOutMs
        )
      }
      val timeline = PreviewTimeline.create(mode, clips)
      val current = ActivePreview(token, timeline)
      active = current
      timeline.tracks.forEach { track ->
        val processor = PreviewEnvelopeAudioProcessor(
          track.items.mapNotNull(TrackPlaylistItem::clip)
        )
        val player = buildPlayer(processor)
        processor.requestSeekPositionMs(0L)
        val listener = buildListener(token, player, current.tracks.isEmpty())
        player.addListener(listener)
        val sources = buildMediaSources(track)
        player.setMediaSources(sources, true)
        current.tracks += TrackPlayer(track, processor, player, listener)
      }
      if (current.tracks.isEmpty() || current.tracks.size > MAX_TRACKS) {
        throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
      }

      suspendCancellableCoroutine { continuation ->
        pendingPrepare = PendingPrepare(token, current.tracks.size, mutableSetOf(), continuation)
        continuation.invokeOnCancellation {
          mainHandler.post {
            if (pendingPrepare?.continuation === continuation) pendingPrepare = null
          }
        }
        try {
          current.tracks.forEach { it.player.prepare() }
        } catch (error: Throwable) {
          pendingPrepare = null
          continuation.resumeWithException(
            mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED, cause = error)
          )
        }
      }
    } catch (error: Throwable) {
      if (sessionGate.isCurrent(token)) {
        releasePlayers()
        failPendingPrepare(mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED))
        active = null
        sessionGate.release(token)
      }
      throw when (error) {
        is SnapCutMediaException,
        is CancellationException -> error
        else -> mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED, cause = error)
      }
    }
  }

  private fun buildPlayer(processor: PreviewEnvelopeAudioProcessor): ExoPlayer {
    registerNoisyReceiver()
    val renderersFactory = object : DefaultRenderersFactory(applicationContext) {
      override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean
      ): AudioSink = DefaultAudioSink.Builder(context)
        .setAudioProcessors(arrayOf(processor))
        .build()
    }
    return ExoPlayer.Builder(applicationContext, renderersFactory).build().also { created ->
      created.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
          .build(),
        false
      )
      created.repeatMode = Player.REPEAT_MODE_OFF
      created.shuffleModeEnabled = false
    }
  }

  private fun buildMediaSources(track: PreviewTrackPlaylist): List<MediaSource> {
    val factory = DefaultMediaSourceFactory(applicationContext)
    return track.items.mapIndexed { index, item ->
      val clip = item.clip
      if (clip == null) {
        SilenceMediaSource.Factory()
          .setDurationUs(Math.multiplyExact(item.durationMs, 1_000L))
          .setTag("${track.trackId.value}:gap:$index")
          .createMediaSource()
      } else {
        factory.createMediaSource(
          MediaItem.Builder()
            .setMediaId(clip.clipId)
            .setUri(clip.audioFileUri)
            .setClippingConfiguration(
              MediaItem.ClippingConfiguration.Builder()
                .setStartPositionMs(clip.startMs)
                .setEndPositionMs(clip.endMs)
                .build()
            )
            .build()
        )
      }
    }
  }

  private fun buildListener(
    token: PreviewSessionToken,
    player: ExoPlayer,
    master: Boolean
  ): Player.Listener = object : Player.Listener {
    override fun onPlaybackStateChanged(playbackState: Int) {
      if (!acceptCallback(token)) return
      val current = active ?: return
      when (playbackState) {
        Player.STATE_READY -> {
          markReady(token, player)
          maybeResumeAfterSeek(current)
        }
        Player.STATE_ENDED -> if (master && current.completionArmed) finishPreview(token)
        Player.STATE_BUFFERING -> if (master && current.prepared && current.desiredPlaying) {
          emitStatus("buffering")
        }
        else -> Unit
      }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (!master || !acceptPreparedCallback(token) || active?.completed == true) return
      val current = active ?: return
      if (isPlaying && !current.desiredPlaying) {
        current.tracks.forEach { it.player.pause() }
        stopProgressEvents()
        return
      }
      if (current.lastReportedPlaying == isPlaying) return
      stopProgressEvents()
      if (isPlaying) mainHandler.post(progressTicker)
      emitStatus(if (isPlaying) "playing" else "paused")
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      if (
        master &&
        acceptPreparedCallback(token) &&
        active?.completed != true &&
        active?.desiredPlaying == true
      ) {
        emitStatus("item-transition")
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      if (!acceptCallback(token)) return
      val stable = mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED, cause = error)
      emitError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
      failPendingPrepare(stable)
      releasePlayers()
      sessionGate.release(token)
      active = null
    }
  }

  private fun markReady(token: PreviewSessionToken, player: ExoPlayer) {
    val pending = pendingPrepare?.takeIf { it.token == token } ?: return
    pending.readyPlayers += player
    if (pending.readyPlayers.size != pending.expectedPlayers) return
    pendingPrepare = null
    active?.takeIf { it.token == token }?.prepared = true
    emitStatus("ready")
    if (pending.continuation.isActive) pending.continuation.resume(Unit)
  }

  private fun seekAll(
    current: ActivePreview,
    positionMs: Long,
    resumeAfterReady: Boolean = current.tracks.any { it.player.isPlaying }
  ) {
    val previousSuppression = suppressPlayerEvents
    suppressPlayerEvents = true
    try {
      current.resumeAfterSeek = resumeAfterReady
      if (resumeAfterReady) current.tracks.forEach { it.player.pause() }
      current.tracks.forEach { track ->
        val target = track.timeline.seekTarget(positionMs)
        track.processor.requestSeekPositionMs(positionMs)
        track.player.seekTo(target.itemIndex, target.positionInItemMs)
      }
    } finally {
      suppressPlayerEvents = previousSuppression
    }
    if (resumeAfterReady) mainHandler.post { maybeResumeAfterSeek(current) }
  }

  private fun synchronizeFollowers(current: ActivePreview) {
    val master = current.tracks.firstOrNull() ?: return
    val masterPosition = globalPosition(master)
    current.tracks.drop(1).forEach { follower ->
      if (abs(globalPosition(follower) - masterPosition) > MAX_TRACK_DRIFT_MS) {
        seekAll(current, masterPosition, resumeAfterReady = true)
        return
      }
    }
  }

  private fun globalPosition(track: TrackPlayer): Long = if (
    track.player.currentMediaItemIndex in track.timeline.items.indices
  ) {
    track.timeline.globalPosition(track.player.currentMediaItemIndex, track.player.currentPosition)
  } else {
    0L
  }

  private fun emitStatus(stage: String, didJustFinish: Boolean = false) {
    val current = active ?: return
    if (!sessionGate.isCurrent(current.token)) return
    val master = current.tracks.firstOrNull()
    val positionMs = if (current.prepared && master != null) globalPosition(master) else 0L
    val position = current.timeline.positionAt(positionMs)
    val playing = master?.player?.isPlaying == true
    val controlRevision = sessionGate.currentControlRevision(current.token) ?: return
    dispatchEvent(
      PLAYBACK_EVENT,
      mapOf(
        "jobId" to current.token.playbackSessionId,
        "operation" to "preview",
        "sequence" to current.nextSequence++,
        "stage" to stage,
        "generation" to current.token.generation,
        "playbackSessionId" to current.token.playbackSessionId,
        "controlRevision" to controlRevision,
        "mode" to current.timeline.mode.wireValue,
        "loaded" to current.prepared,
        "playing" to playing,
        "positionMs" to position.compositionPositionMs,
        "durationMs" to current.timeline.durationMs,
        "currentClipIndex" to position.clipIndex,
        "currentClipId" to position.clipId,
        "didJustFinish" to didJustFinish
      )
    )
    current.lastReportedPlaying = playing
  }

  private fun finishPreview(token: PreviewSessionToken) {
    if (!sessionGate.isCurrent(token)) return
    val current = active ?: return
    if (current.completed) return
    current.completed = true
    current.completionArmed = false
    current.desiredPlaying = false
    suppressPlayerEvents = true
    try {
      current.tracks.forEach { it.player.pause() }
      abandonAudioFocus()
      seekAll(current, 0L, resumeAfterReady = false)
    } finally {
      suppressPlayerEvents = false
    }
    emitStatus("completed", didJustFinish = true)
  }

  private fun emitError(error: SnapCutMediaError) {
    val current = active ?: return
    if (!sessionGate.isCurrent(current.token)) return
    dispatchEvent(
      ERROR_EVENT,
      mapOf(
        "jobId" to current.token.playbackSessionId,
        "operation" to "preview",
        "sequence" to current.nextSequence++,
        "stage" to "error",
        "generation" to current.token.generation,
        "code" to error.code,
        "message" to error.safeMessage
      )
    )
  }

  private fun requireActive(request: PreviewCommandRequest): ActivePreview {
    checkNotDestroyed()
    val token = PreviewSessionToken(request.playbackSessionId, request.generation)
    return active?.takeIf { it.token == token && sessionGate.isCurrent(token) }
      ?: throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
  }

  private fun acceptCallback(token: PreviewSessionToken): Boolean =
    !suppressPlayerEvents && active?.token == token && sessionGate.isCurrent(token)

  private fun acceptPreparedCallback(token: PreviewSessionToken): Boolean =
    acceptCallback(token) && active?.prepared == true

  private fun failPendingPrepare(error: Throwable) {
    val pending = pendingPrepare ?: return
    pendingPrepare = null
    if (pending.continuation.isActive) pending.continuation.resumeWithException(error)
  }

  private fun onAudioFocusChange(change: Int) {
    if (
      change == AudioManager.AUDIOFOCUS_LOSS ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
    ) pauseForInterruption("audio-focus-lost")
  }

  private fun pauseForInterruption(stage: String) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      mainHandler.post { pauseForInterruption(stage) }
      return
    }
    val current = active ?: return
    sessionGate.advanceControl(current.token) ?: return
    current.desiredPlaying = false
    pausePlayers(stage)
  }

  private fun pausePlayers(stage: String, emit: Boolean = true) {
    val current = active ?: return
    val previousSuppression = suppressPlayerEvents
    suppressPlayerEvents = true
    try {
      pauseCoordinator.pause(
        trackCount = current.tracks.size,
        stopProgressTicker = ::stopProgressEvents,
        clearResumeIntent = {
          current.completionArmed = false
          current.resumeAfterSeek = false
        },
        pauseTrack = { index -> current.tracks[index].player.pause() },
        abandonAudioFocus = ::abandonAudioFocus,
        acknowledgePaused = { if (emit) emitStatus(stage) }
      )
    } finally {
      suppressPlayerEvents = previousSuppression
    }
  }

  private fun releasePlayers() {
    stopProgressEvents()
    pausePlayers("detached", emit = false)
    active?.tracks?.forEach { track ->
      runCatching { track.player.removeListener(track.listener) }
      runCatching { track.player.stop() }
      runCatching { track.player.clearMediaItems() }
      runCatching { track.player.release() }
    }
    active?.tracks?.clear()
  }

  private fun maybeResumeAfterSeek(current: ActivePreview) {
    if (
      active !== current ||
      !current.resumeAfterSeek ||
      !current.desiredPlaying ||
      !current.prepared ||
      current.completed ||
      current.tracks.any { it.player.playbackState != Player.STATE_READY }
    ) return
    current.resumeAfterSeek = false
    current.tracks.asReversed().forEach { it.player.play() }
  }

  private fun abandonAudioFocus() {
    if (focusHeld) audioManager.abandonAudioFocusRequest(focusRequest)
    focusHeld = false
  }

  private fun stopProgressEvents() = mainHandler.removeCallbacks(progressTicker)

  private fun dispatchEvent(eventName: String, body: Map<String, Any?>) {
    runCatching { eventSink.emit(eventName, body) }
  }

  private fun registerNoisyReceiver() {
    if (noisyReceiverRegistered) return
    val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      applicationContext.registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      applicationContext.registerReceiver(noisyReceiver, filter)
    }
    noisyReceiverRegistered = true
  }

  private fun destroyOnMain() {
    if (destroyed) return
    destroyed = true
    releasePlayers()
    failPendingPrepare(mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED))
    active = null
    sessionGate.clear()
    if (noisyReceiverRegistered) {
      runCatching { applicationContext.unregisterReceiver(noisyReceiver) }
      noisyReceiverRegistered = false
    }
  }

  private fun checkNotDestroyed() {
    if (destroyed) throw mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE)
  }

  private suspend fun <T> onMain(block: suspend () -> T): T =
    withContext(Dispatchers.Main.immediate) { block() }

  private companion object {
    const val MAX_TRACKS = 2
    const val MAX_TRACK_DRIFT_MS = 30L
    const val PROGRESS_INTERVAL_MS = 50L
    const val PLAYBACK_EVENT = "onPlaybackStatus"
    const val ERROR_EVENT = "onNativeError"
  }
}
