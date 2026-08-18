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
  private var latestControlRevision = -1L

  fun begin(
    playbackSessionId: String,
    generation: Long,
    controlRevision: Long = 0L
  ): PreviewSessionToken? = synchronized(lock) {
    if (
      playbackSessionId.isBlank() ||
      generation < 0L ||
      controlRevision < 0L ||
      generation < highestGeneration
    ) {
      return@synchronized null
    }
    if (
      generation == highestGeneration &&
      latest != null &&
      latest?.playbackSessionId != playbackSessionId
    ) {
      return@synchronized null
    }
    val requested = PreviewSessionToken(playbackSessionId, generation)
    val sameActiveSession = active == requested
    if (sameActiveSession && controlRevision < latestControlRevision) {
      return@synchronized null
    }
    highestGeneration = generation
    requested.also {
      latest = it
      active = it
      latestControlRevision = if (sameActiveSession) {
        maxOf(latestControlRevision, controlRevision)
      } else {
        controlRevision
      }
    }
  }

  fun isCurrent(token: PreviewSessionToken): Boolean = synchronized(lock) { active == token }

  /** Accepts equal revisions for the seek/play steps of one user intent. */
  fun acceptControl(token: PreviewSessionToken, controlRevision: Long): Boolean =
    synchronized(lock) {
      if (active != token || controlRevision < latestControlRevision) false else {
        latestControlRevision = controlRevision
        true
      }
    }

  fun currentControlRevision(token: PreviewSessionToken): Long? = synchronized(lock) {
    latestControlRevision.takeIf { active == token }
  }

  fun advanceControl(token: PreviewSessionToken): Long? = synchronized(lock) {
    if (active != token) null else {
      latestControlRevision = Math.addExact(latestControlRevision, 1L)
      latestControlRevision
    }
  }

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
    latestControlRevision = -1L
  }
}
