package expo.modules.snapcutmedia.jobs

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.NativeOperation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

internal fun interface NativeJobResource {
  fun cancel()
}

internal class NativeJobRegistry {
  private data class ActiveJob(
    val jobId: String,
    val operation: NativeOperation,
    val generation: Long,
    val job: Job,
    val cancellationRequested: AtomicBoolean = AtomicBoolean(false),
    val resources: MutableSet<NativeJobResource> = linkedSetOf(),
    var nextSequence: Long = 1L
  )

  private val lock = Any()
  private val jobs = linkedMapOf<NativeOperation, ActiveJob>()
  private var previewSessionId: String? = null
  private var latestPreviewSessionId: String? = null
  private var previewGeneration: Long = -1L

  fun register(
    operation: NativeOperation,
    jobId: String,
    generation: Long,
    job: Job
  ) {
    requireIdentifiers(jobId, generation)
    synchronized(lock) {
      val conflictsWithHeavyJob = operation in HEAVY_OPERATIONS &&
        jobs.keys.any { active -> active in HEAVY_OPERATIONS }
      if (jobs.containsKey(operation) || conflictsWithHeavyJob) {
        throw mediaError(SnapCutMediaError.JOB_ALREADY_RUNNING)
      }
      jobs[operation] = ActiveJob(jobId, operation, generation, job)
    }
  }

  fun complete(operation: NativeOperation, jobId: String, generation: Long, job: Job) {
    val resources = synchronized(lock) {
      val active = jobs[operation]
      if (
        active == null ||
        active.jobId != jobId ||
        active.generation != generation ||
        active.job !== job
      ) {
        return
      }
      jobs.remove(operation)
      active.resources.toList().also { active.resources.clear() }
    }
    release(resources)
  }

  fun attach(
    operation: NativeOperation,
    jobId: String,
    generation: Long,
    resource: NativeJobResource
  ) {
    val accepted = synchronized(lock) {
      jobs[operation]
        ?.takeIf {
          it.jobId == jobId &&
            it.generation == generation &&
            !it.cancellationRequested.get()
        }
        ?.resources
        ?.add(resource) == true
    }
    if (!accepted) {
      runCatching(resource::cancel)
      throw mediaError(cancelError(operation))
    }
  }

  fun detach(
    operation: NativeOperation,
    jobId: String,
    generation: Long,
    resource: NativeJobResource
  ) {
    synchronized(lock) {
      jobs[operation]
        ?.takeIf { it.jobId == jobId && it.generation == generation }
        ?.resources
        ?.remove(resource)
    }
  }

  fun cancel(operation: NativeOperation, jobId: String) {
    val cancellation = requestCancellation(operation, jobId) ?: return
    release(cancellation.second)
    cancellation.first.cancel(NativeCancellationSignal(operation.value))
  }

  /** Returns only after the worker's finally blocks have completed and all handles are closed. */
  suspend fun cancelAndJoin(operation: NativeOperation, jobId: String) {
    val cancellation = requestCancellation(operation, jobId) ?: return
    release(cancellation.second)
    val worker = cancellation.first
    worker.cancel(NativeCancellationSignal(operation.value))
    if (worker !== currentCoroutineContext().job) {
      withContext(NonCancellable) { worker.join() }
    }
  }

  fun nextSequence(operation: NativeOperation, jobId: String, generation: Long): Long =
    synchronized(lock) {
      val active = jobs[operation]
        ?.takeIf { it.jobId == jobId && it.generation == generation }
        ?: throw mediaError(cancelError(operation))
      active.nextSequence++
    }

  fun isCurrent(operation: NativeOperation, jobId: String, generation: Long): Boolean =
    synchronized(lock) {
      jobs[operation]?.let {
        it.jobId == jobId && it.generation == generation && !it.cancellationRequested.get()
      } == true
    }

  fun beginPreview(playbackSessionId: String, generation: Long): Boolean {
    requireIdentifiers(playbackSessionId, generation)
    return synchronized(lock) {
      if (
        generation < previewGeneration ||
        (generation == previewGeneration && latestPreviewSessionId != playbackSessionId)
      ) {
        false
      } else {
        previewSessionId = playbackSessionId
        latestPreviewSessionId = playbackSessionId
        previewGeneration = generation
        true
      }
    }
  }

  fun isCurrentPreview(playbackSessionId: String, generation: Long): Boolean = synchronized(lock) {
    previewSessionId == playbackSessionId && previewGeneration == generation
  }

  fun releasePreview(playbackSessionId: String, generation: Long): Boolean = synchronized(lock) {
    if (previewSessionId == playbackSessionId && previewGeneration == generation) {
      previewSessionId = null
      true
    } else {
      false
    }
  }

  fun cancelAll() {
    val cancellation = synchronized(lock) {
      val active = jobs.values.toList()
      jobs.clear()
      previewSessionId = null
      latestPreviewSessionId = null
      previewGeneration = -1L
      active
    }
    cancellation.forEach { active ->
      release(active.resources)
      active.job.cancel(NativeCancellationSignal(active.operation.value))
    }
  }

  internal fun activeOperation(): NativeOperation? = synchronized(lock) { jobs.keys.firstOrNull() }

  private fun release(resources: Collection<NativeJobResource>) {
    resources.forEach { resource -> runCatching(resource::cancel) }
  }

  private fun requestCancellation(
    operation: NativeOperation,
    jobId: String
  ): Pair<Job, List<NativeJobResource>>? = synchronized(lock) {
    val active = jobs[operation]
      ?.takeIf { it.jobId == jobId }
      ?: return@synchronized null
    val resources = if (active.cancellationRequested.compareAndSet(false, true)) {
      active.resources.toList().also { active.resources.clear() }
    } else {
      emptyList()
    }
    active.job to resources
  }

  private fun requireIdentifiers(identifier: String, generation: Long) {
    if (identifier.isBlank() || generation < 0L) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
  }

  private fun cancelError(operation: NativeOperation): SnapCutMediaError = when (operation) {
    NativeOperation.IMPORT -> SnapCutMediaError.IMPORT_CANCELLED
    NativeOperation.WAVEFORM -> SnapCutMediaError.WAVEFORM_CANCELLED
    NativeOperation.EXPORT,
    NativeOperation.PREFLIGHT -> SnapCutMediaError.EXPORT_CANCELLED
    NativeOperation.PREVIEW -> SnapCutMediaError.PREVIEW_PREPARE_FAILED
  }

  private companion object {
    val HEAVY_OPERATIONS = setOf(
      NativeOperation.IMPORT,
      NativeOperation.WAVEFORM,
      NativeOperation.PREFLIGHT,
      NativeOperation.EXPORT
    )
  }
}

internal class NativeCancellationSignal(operation: String) :
  CancellationException("$operation cancelled")
