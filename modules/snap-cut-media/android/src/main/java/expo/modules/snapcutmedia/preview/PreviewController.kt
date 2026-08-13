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
import androidx.media3.exoplayer.ExoPlayer
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.LoadPreviewRequest
import expo.modules.snapcutmedia.models.PreviewCommandRequest
import expo.modules.snapcutmedia.models.SeekPreviewRequest
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.concurrent.CountDownLatch
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal fun interface PreviewEventSink {
  fun emit(eventName: String, body: Map<String, Any?>)
}

/**
 * Owns SnapCut's only ExoPlayer. All player access is serialized onto the main
 * looper; decoded audio and waveform data never cross the React Native bridge.
 */
internal class PreviewController(
  context: Context,
  private val eventSink: PreviewEventSink
) {
  private data class ActivePreview(
    val token: PreviewSessionToken,
    val timeline: PreviewTimeline,
    var prepared: Boolean = false,
    var completed: Boolean = false,
    var completionArmed: Boolean = false,
    var nextSequence: Long = 1L
  )

  private data class PendingPrepare(
    val token: PreviewSessionToken,
    val continuation: CancellableContinuation<Unit>
  )

  private val applicationContext = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  private val sourcePolicy = CommittedPreviewSource(applicationContext.filesDir)
  private val sessionGate = PreviewSessionGate()
  private val audioManager = applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val platformAudioAttributes = android.media.AudioAttributes.Builder()
    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
    .build()
  private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
    onAudioFocusChange(change)
  }
  private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
    .setAudioAttributes(platformAudioAttributes)
    .setWillPauseWhenDucked(true)
    .setOnAudioFocusChangeListener(audioFocusChangeListener, mainHandler)
    .build()

  private var player: ExoPlayer? = null
  private var active: ActivePreview? = null
  private var pendingPrepare: PendingPrepare? = null
  private var focusHeld = false
  private var noisyReceiverRegistered = false
  private var destroyed = false
  private var suppressPlayerEvents = false
  private var sessionPlayerListener: Player.Listener? = null

  private val progressTicker = object : Runnable {
    override fun run() {
      val currentPlayer = player
      if (currentPlayer?.isPlaying != true || active == null) return
      emitStatus(stage = "playing")
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
    val currentPlayer = requireNotNull(player)
    if (!current.prepared) throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
    if (audioManager.requestAudioFocus(focusRequest) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
    }
    focusHeld = true
    try {
      current.completed = false
      current.completionArmed = true
      if (currentPlayer.playbackState == Player.STATE_ENDED) currentPlayer.seekTo(0, 0L)
      currentPlayer.play()
    } catch (error: Throwable) {
      current.completionArmed = false
      abandonAudioFocus()
      throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED, cause = error)
    }
  }

  suspend fun pause(request: PreviewCommandRequest) = onMain {
    requireActive(request)
    pausePlayer("paused")
  }

  suspend fun seek(request: SeekPreviewRequest) = onMain {
    val current = requireActive(
      PreviewCommandRequest(request.playbackSessionId, request.generation)
    )
    if (!current.prepared) throw mediaError(SnapCutMediaError.PREVIEW_SEEK_FAILED)
    val target = current.timeline.seekTarget(request.positionMs)
    try {
      current.completed = false
      requireNotNull(player).seekTo(target.clipIndex, target.positionInClipMs)
    } catch (error: Throwable) {
      throw mediaError(SnapCutMediaError.PREVIEW_SEEK_FAILED, cause = error)
    }
    if (!current.completed) emitStatusAt(target, stage = "seek")
  }

  /** Completes only after the player no longer references project source files. */
  suspend fun release(request: PreviewCommandRequest) = onMain {
    val token = PreviewSessionToken(request.playbackSessionId, request.generation)
    if (!sessionGate.isCurrent(token)) return@onMain
    detachMediaItems()
    failPendingPrepare(mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED))
    sessionGate.release(token)
    active = null
  }

  /** Lifecycle teardown is synchronous so no player callback outlives the module. */
  fun destroy() {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      destroyOnMain()
      return
    }
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
    val token = sessionGate.begin(request.playbackSessionId, request.generation)
      ?: throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    if (active?.token == token) return@onMain
    try {
      // A newer load owns the native session immediately. Detach the previous
      // sources before validating the replacement so even a failed load cannot
      // leave a project file referenced by an unreachable stale session.
      detachMediaItems()
      failPendingPrepare(mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED))
      active = null

      val clips = request.clips.map { clip ->
        val privateFile = sourcePolicy.requireCommittedFile(clip.audioFileUri, clip.sourceId)
        PreviewClip(
          clipId = clip.clipId,
          sourceId = clip.sourceId,
          audioFileUri = Uri.fromFile(privateFile).toString(),
          startMs = clip.startMs,
          endMs = clip.endMs
        )
      }
      val timeline = PreviewTimeline.create(mode, clips)
      val currentPlayer = ensurePlayer()
      active = ActivePreview(token, timeline)
      attachPlayerListener(currentPlayer, token)

      val mediaItems = clips.map { clip ->
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
      }
      currentPlayer.setMediaItems(mediaItems, true)

      suspendCancellableCoroutine { continuation ->
        pendingPrepare = PendingPrepare(token, continuation)
        continuation.invokeOnCancellation {
          mainHandler.post {
            if (pendingPrepare?.continuation === continuation) pendingPrepare = null
          }
        }
        try {
          currentPlayer.prepare()
        } catch (error: Throwable) {
          pendingPrepare = null
          continuation.resumeWithException(
            mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED, cause = error)
          )
        }
      }
    } catch (error: Throwable) {
      if (sessionGate.isCurrent(token)) {
        detachMediaItems()
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

  private fun ensurePlayer(): ExoPlayer {
    checkNotDestroyed()
    player?.let { return it }
    registerNoisyReceiver()
    return ExoPlayer.Builder(applicationContext)
      .build()
      .also { created ->
        created.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build(),
          false
        )
        created.repeatMode = Player.REPEAT_MODE_OFF
        created.shuffleModeEnabled = false
        player = created
      }
  }

  private fun attachPlayerListener(currentPlayer: ExoPlayer, token: PreviewSessionToken) {
    detachPlayerListener()
    val listener = object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) {
        if (!acceptPlayerCallback(token)) return
        val current = active ?: return
        if (current.completed) return
        when (playbackState) {
          Player.STATE_READY -> {
            current.prepared = true
            emitStatus(stage = "ready")
            completePendingPrepare(token)
          }
          Player.STATE_ENDED -> if (current.completionArmed) finishPreview(token)
          Player.STATE_BUFFERING -> if (current.prepared) emitStatus(stage = "buffering")
          else -> Unit
        }
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (!acceptPreparedPlayerCallback(token)) return
        if (active?.completed == true) return
        stopProgressEvents()
        if (isPlaying) mainHandler.post(progressTicker)
        emitStatus(stage = if (isPlaying) "playing" else "paused")
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        if (!acceptPreparedPlayerCallback(token)) return
        if (active?.completed == true) return
        emitStatus(stage = "item-transition")
      }

      override fun onPlayerError(error: PlaybackException) {
        if (!acceptPlayerCallback(token)) return
        val stableError = mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED, cause = error)
        emitError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
        failPendingPrepare(stableError)
        detachMediaItems()
        sessionGate.release(token)
        active = null
      }
    }
    currentPlayer.addListener(listener)
    sessionPlayerListener = listener
  }

  private fun acceptPlayerCallback(token: PreviewSessionToken): Boolean =
    !suppressPlayerEvents && active?.token == token && sessionGate.isCurrent(token)

  private fun acceptPreparedPlayerCallback(token: PreviewSessionToken): Boolean =
    acceptPlayerCallback(token) && active?.prepared == true

  private fun detachPlayerListener() {
    val listener = sessionPlayerListener ?: return
    player?.removeListener(listener)
    sessionPlayerListener = null
  }

  private fun requireActive(request: PreviewCommandRequest): ActivePreview {
    checkNotDestroyed()
    val token = PreviewSessionToken(request.playbackSessionId, request.generation)
    return active?.takeIf { it.token == token && sessionGate.isCurrent(token) }
      ?: throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
  }

  private fun completePendingPrepare(token: PreviewSessionToken) {
    val pending = pendingPrepare?.takeIf { it.token == token } ?: return
    pendingPrepare = null
    if (pending.continuation.isActive) pending.continuation.resume(Unit)
  }

  private fun failPendingPrepare(error: Throwable) {
    val pending = pendingPrepare ?: return
    pendingPrepare = null
    if (pending.continuation.isActive) pending.continuation.resumeWithException(error)
  }

  private fun emitStatus(stage: String, didJustFinish: Boolean = false) {
    val current = active ?: return
    if (!sessionGate.isCurrent(current.token)) return
    val currentPlayer = player
    val index = currentPlayer?.currentMediaItemIndex ?: C.INDEX_UNSET
    val position = if (current.prepared && index in current.timeline.clips.indices) {
      current.timeline.position(index, currentPlayer?.currentPosition ?: 0L)
    } else null
    dispatchEvent(
      PLAYBACK_EVENT,
      playbackEvent(
        current = current,
        stage = stage,
        loaded = current.prepared,
        playing = currentPlayer?.isPlaying == true,
        positionMs = position?.compositionPositionMs ?: 0L,
        clipIndex = position?.clipIndex,
        clipId = position?.clipId,
        didJustFinish = didJustFinish
      )
    )
  }

  private fun emitStatusAt(
    target: PreviewSeekTarget,
    stage: String,
    didJustFinish: Boolean = false
  ) {
    val current = active ?: return
    if (!sessionGate.isCurrent(current.token)) return
    dispatchEvent(
      PLAYBACK_EVENT,
      playbackEvent(
        current = current,
        stage = stage,
        loaded = current.prepared,
        playing = player?.isPlaying == true,
        positionMs = target.compositionPositionMs,
        clipIndex = target.clipIndex,
        clipId = current.timeline.clips[target.clipIndex].clipId,
        didJustFinish = didJustFinish
      )
    )
  }

  private fun playbackEvent(
    current: ActivePreview,
    stage: String,
    loaded: Boolean,
    playing: Boolean,
    positionMs: Long,
    clipIndex: Int?,
    clipId: String?,
    didJustFinish: Boolean
  ): Map<String, Any?> = mapOf(
    "jobId" to current.token.playbackSessionId,
    "operation" to "preview",
    "sequence" to current.nextSequence++,
    "stage" to stage,
    "generation" to current.token.generation,
    "playbackSessionId" to current.token.playbackSessionId,
    "mode" to current.timeline.mode.wireValue,
    "loaded" to loaded,
    "playing" to playing,
    "positionMs" to positionMs,
    "durationMs" to current.timeline.durationMs,
    "currentClipIndex" to clipIndex,
    "currentClipId" to clipId,
    "didJustFinish" to didJustFinish
  )

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

  private fun finishPreview(token: PreviewSessionToken) {
    if (!sessionGate.isCurrent(token)) return
    val current = active ?: return
    if (current.completed) return
    current.completed = true
    current.completionArmed = false
    val currentPlayer = player ?: return
    suppressPlayerEvents = true
    try {
      currentPlayer.pause()
      abandonAudioFocus()
      currentPlayer.seekTo(0, 0L)
    } finally {
      suppressPlayerEvents = false
    }
    emitStatusAt(
      PreviewSeekTarget(0, 0L, 0L),
      stage = "completed",
      didJustFinish = true
    )
  }

  private fun onAudioFocusChange(change: Int) {
    if (
      change == AudioManager.AUDIOFOCUS_LOSS ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
    ) {
      pauseForInterruption("audio-focus-lost")
    }
    // AUDIOFOCUS_GAIN intentionally does nothing: SnapCut never auto-resumes.
  }

  private fun pauseForInterruption(stage: String) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      mainHandler.post { pauseForInterruption(stage) }
      return
    }
    if (active == null) return
    pausePlayer(stage)
  }

  private fun pausePlayer(stage: String, emit: Boolean = true) {
    active?.completionArmed = false
    player?.pause()
    stopProgressEvents()
    abandonAudioFocus()
    if (emit) emitStatus(stage)
  }

  private fun abandonAudioFocus() {
    if (focusHeld) audioManager.abandonAudioFocusRequest(focusRequest)
    focusHeld = false
  }

  private fun stopProgressEvents() {
    mainHandler.removeCallbacks(progressTicker)
  }

  private fun dispatchEvent(eventName: String, body: Map<String, Any?>) {
    runCatching { eventSink.emit(eventName, body) }
  }

  private fun detachMediaItems() {
    stopProgressEvents()
    detachPlayerListener()
    pausePlayer("detached", emit = false)
    player?.let { currentPlayer ->
      currentPlayer.stop()
      if (currentPlayer.mediaItemCount > 0) currentPlayer.clearMediaItems()
    }
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
    detachMediaItems()
    failPendingPrepare(mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED))
    player?.release()
    player = null
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
    const val PROGRESS_INTERVAL_MS = 100L
    const val PLAYBACK_EVENT = "onPlaybackStatus"
    const val ERROR_EVENT = "onNativeError"
  }
}
