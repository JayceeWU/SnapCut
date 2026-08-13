package expo.modules.snapcutmedia.preview

internal data class PreviewSessionToken(
  val playbackSessionId: String,
  val generation: Long
)

/** Rejects callbacks and commands from superseded asynchronous player loads. */
internal class PreviewSessionGate {
  private val lock = Any()
  private var active: PreviewSessionToken? = null
  private var latest: PreviewSessionToken? = null
  private var highestGeneration = -1L

  fun begin(playbackSessionId: String, generation: Long): PreviewSessionToken? = synchronized(lock) {
    if (playbackSessionId.isBlank() || generation < 0L || generation < highestGeneration) {
      return@synchronized null
    }
    if (
      generation == highestGeneration &&
      latest != null &&
      latest?.playbackSessionId != playbackSessionId
    ) {
      return@synchronized null
    }
    highestGeneration = generation
    PreviewSessionToken(playbackSessionId, generation).also {
      latest = it
      active = it
    }
  }

  fun isCurrent(token: PreviewSessionToken): Boolean = synchronized(lock) { active == token }

  fun release(token: PreviewSessionToken): Boolean = synchronized(lock) {
    if (active != token) false else {
      active = null
      true
    }
  }

  fun clear() = synchronized(lock) {
    active = null
    latest = null
    highestGeneration = -1L
  }
}
