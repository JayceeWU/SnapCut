package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError

/**
 * Keeps cancellation and the irreversible MediaStore publication point in one linear order.
 * The entry remains registered until the module has completed the native job, so a cancellation
 * arriving after publication cannot cancel the coroutine before its success reaches JavaScript.
 */
internal class ExportCommitGate {
  private enum class State {
    RUNNING,
    CANCELLED,
    COMMITTING,
    COMMITTED,
    FAILED
  }

  private data class Entry(
    val jobId: String,
    val generation: Long,
    var state: State = State.RUNNING
  )

  private val lock = Any()
  private var active: Entry? = null

  fun begin(jobId: String, generation: Long) {
    if (jobId.isBlank() || generation < 0L) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
    synchronized(lock) {
      if (active != null) throw mediaError(SnapCutMediaError.JOB_ALREADY_RUNNING)
      active = Entry(jobId, generation)
    }
  }

  fun boundary(jobId: String, generation: Long): MediaStoreCommitBoundary =
    MediaStoreCommitBoundary { action -> commit(jobId, generation, action) }

  /** Returns true only when the caller must still cancel and join the native worker. */
  fun requestCancellation(jobId: String): Boolean = synchronized(lock) {
    val entry = active?.takeIf { it.jobId == jobId } ?: return@synchronized true
    when (entry.state) {
      State.RUNNING -> {
        entry.state = State.CANCELLED
        true
      }
      State.CANCELLED -> true
      State.COMMITTING,
      State.COMMITTED,
      State.FAILED -> false
    }
  }

  fun complete(jobId: String, generation: Long) {
    synchronized(lock) {
      active?.takeIf { it.jobId == jobId && it.generation == generation }?.let {
        active = null
      }
    }
  }

  fun clear() {
    synchronized(lock) { active = null }
  }

  private fun commit(
    jobId: String,
    generation: Long,
    action: () -> Boolean
  ): Boolean = synchronized(lock) {
    val entry = active?.takeIf { it.jobId == jobId && it.generation == generation }
      ?: throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
    when (entry.state) {
      State.CANCELLED -> throw mediaError(SnapCutMediaError.EXPORT_CANCELLED)
      State.RUNNING -> entry.state = State.COMMITTING
      State.COMMITTING,
      State.COMMITTED,
      State.FAILED -> throw mediaError(SnapCutMediaError.EXPORT_MEDIASTORE_FAILED)
    }
    try {
      action().also { committed ->
        entry.state = if (committed) State.COMMITTED else State.FAILED
      }
    } catch (error: Exception) {
      entry.state = State.FAILED
      throw error
    }
  }
}
