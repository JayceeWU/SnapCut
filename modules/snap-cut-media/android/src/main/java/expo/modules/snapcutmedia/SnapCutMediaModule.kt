package expo.modules.snapcutmedia

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.snapcutmedia.codec.NativeCodecBridge
import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.SnapCutMediaException
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.exportmedia.ExportProgress
import expo.modules.snapcutmedia.exportmedia.SnapCutExportServices
import expo.modules.snapcutmedia.jobs.NativeJobRegistry
import expo.modules.snapcutmedia.jobs.NativeJobResource
import expo.modules.snapcutmedia.importmedia.ImportProgress
import expo.modules.snapcutmedia.importmedia.ImportStage
import expo.modules.snapcutmedia.importmedia.MediaImportService
import expo.modules.snapcutmedia.models.ExportAudioRequest
import expo.modules.snapcutmedia.models.ExportPreflightRequest
import expo.modules.snapcutmedia.models.GenerateWaveformRequest
import expo.modules.snapcutmedia.models.ImportSourceRequest
import expo.modules.snapcutmedia.models.InspectSourceRequest
import expo.modules.snapcutmedia.models.LoadPreviewRequest
import expo.modules.snapcutmedia.models.NativeOperation
import expo.modules.snapcutmedia.models.PickedSource
import expo.modules.snapcutmedia.models.PreviewCommandRequest
import expo.modules.snapcutmedia.models.SeekPreviewRequest
import expo.modules.snapcutmedia.models.ShareExportRequest
import expo.modules.snapcutmedia.models.toBridgeMap
import expo.modules.snapcutmedia.models.VerifyPrivateMediaRequest
import expo.modules.snapcutmedia.preview.PreviewController
import expo.modules.snapcutmedia.preview.PreviewEventSink
import expo.modules.snapcutmedia.source.CancellationCheck
import expo.modules.snapcutmedia.source.MediaResourceHooks
import expo.modules.snapcutmedia.source.SourceInspector
import expo.modules.snapcutmedia.source.SourceInspectionStage
import expo.modules.snapcutmedia.source.SourcePicker
import expo.modules.snapcutmedia.storage.PrivateMediaVerifier
import expo.modules.snapcutmedia.waveform.WaveformProgress
import expo.modules.snapcutmedia.waveform.WaveformService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

@Suppress("unused")
class SnapCutMediaModule : Module() {
  private val destroyed = AtomicBoolean(false)
  private val jobs = NativeJobRegistry()
  private var sourcePicker: SourcePicker? = null
  private var sourceInspector: SourceInspector? = null
  private var importService: MediaImportService? = null
  private var waveformService: WaveformService? = null
  private var previewController: PreviewController? = null
  private var exportServices: SnapCutExportServices? = null
  private var privateMediaVerifier: PrivateMediaVerifier? = null

  override fun definition() = ModuleDefinition {
    Name(MODULE_NAME)

    Events(
      "onImportProgress",
      "onWaveformProgress",
      "onPlaybackStatus",
      "onExportProgress",
      "onNativeError"
    )

    Function("getHealth") {
      mapOf(
        "moduleName" to MODULE_NAME,
        "moduleVersion" to MODULE_VERSION,
        "platform" to "android",
        "ready" to !destroyed.get(),
        "mediaPipelineAvailable" to !destroyed.get()
      )
    }

    Function("getCodecBuildInfo") {
      val codecBuildInfo = NativeCodecBridge.getBuildInfo()
      val media3Available = classAvailable("androidx.media3.common.MediaItem") &&
        classAvailable("androidx.media3.exoplayer.ExoPlayer")
      mapOf(
        "moduleVersion" to MODULE_VERSION,
        "media3" to libraryStatus(BuildConfig.SNAPCUT_MEDIA3_VERSION, media3Available),
        "flac" to libraryStatus(
          codecBuildInfo.flac.version,
          codecBuildInfo.flac.available
        ),
        "lame" to libraryStatus(
          codecBuildInfo.lame.version,
          codecBuildInfo.lame.available
        ),
        "libsamplerate" to libraryStatus(
          codecBuildInfo.libsamplerate.version,
          codecBuildInfo.libsamplerate.available
        ),
        "nativeCodecBridgeLoaded" to codecBuildInfo.bridgeLoaded
      )
    }

    AsyncFunction("pickSource") Coroutine { ->
      if (destroyed.get()) throw mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE)
      picker().pick(appContext.throwingActivity)
    }

    AsyncFunction("inspectSource") Coroutine { request: InspectSourceRequest ->
      val stage = AtomicReference(SourceInspectionStage.SIZE_PROBE)
      try {
        withJob<Map<String, Any?>>(
          NativeOperation.IMPORT,
          request.jobId,
          request.generation
        ) {
          val coroutineJob = currentCoroutineContext().job
          val cancellation = cancellationCheck(
            NativeOperation.IMPORT,
            request.jobId,
            request.generation,
            coroutineJob,
            SnapCutMediaError.IMPORT_CANCELLED
          )
          val hooks = resourceHooks(NativeOperation.IMPORT, request.jobId, request.generation)
          val inspection = withContext(Dispatchers.IO) {
            inspector().inspect(
              request.sourceUri,
              request.maxSourceBytes,
              cancellation,
              hooks,
              onStage = stage::set
            )
          }
          stage.set(SourceInspectionStage.BRIDGE_RESULT)
          inspection.toBridgeMap()
        }
      } catch (error: SnapCutMediaException) {
        emitInspectError(request, error.error, stage.get(), categoryFor(error.error))
        throw error
      } catch (_: LinkageError) {
        emitInspectError(
          request,
          SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE,
          stage.get(),
          "linkage"
        )
        throw mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE)
      } catch (_: Exception) {
        emitInspectError(request, SnapCutMediaError.UNKNOWN_NATIVE_ERROR, stage.get(), "native")
        throw mediaError(SnapCutMediaError.UNKNOWN_NATIVE_ERROR)
      }
    }

    AsyncFunction("verifyPrivateMedia") Coroutine { request: VerifyPrivateMediaRequest ->
      if (destroyed.get()) throw mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE)
      withContext(Dispatchers.IO) { mediaVerifier().verify(request.fileUri) }
    }

    AsyncFunction("importSource") Coroutine { request: ImportSourceRequest ->
      val stage = AtomicReference(ImportStage.INSPECTING)
      try {
        withJob<Map<String, Any?>>(NativeOperation.IMPORT, request.jobId, request.generation) {
          val coroutineJob = currentCoroutineContext().job
          val cancellation = cancellationCheck(
            NativeOperation.IMPORT,
            request.jobId,
            request.generation,
            coroutineJob,
            SnapCutMediaError.IMPORT_CANCELLED
          )
          val hooks = resourceHooks(NativeOperation.IMPORT, request.jobId, request.generation)
          withContext(Dispatchers.IO) {
            mediaImporter().importSource(request, cancellation, hooks) { progress ->
              stage.set(progress.stage)
              emitImportProgress(request, progress)
            }.toBridgeMap()
          }
        }
      } catch (error: SnapCutMediaException) {
        emitImportError(
          request,
          error.error,
          safeImportNativeStage(error.technicalContext, stage.get()),
          categoryFor(error.error)
        )
        throw error
      } catch (_: LinkageError) {
        emitImportError(
          request,
          SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE,
          stage.get().value,
          "linkage"
        )
        throw mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE)
      } catch (_: Exception) {
        emitImportError(
          request,
          SnapCutMediaError.UNKNOWN_NATIVE_ERROR,
          stage.get().value,
          "native"
        )
        throw mediaError(SnapCutMediaError.UNKNOWN_NATIVE_ERROR)
      }
    }

    AsyncFunction("cancelImport") Coroutine { jobId: String ->
      requireJobId(jobId)
      jobs.cancelAndJoin(NativeOperation.IMPORT, jobId)
    }

    AsyncFunction("generateWaveform") Coroutine { request: GenerateWaveformRequest ->
      withJob<Unit>(NativeOperation.WAVEFORM, request.jobId, request.generation) {
        val coroutineJob = currentCoroutineContext().job
        val cancellation = cancellationCheck(
          NativeOperation.WAVEFORM,
          request.jobId,
          request.generation,
          coroutineJob,
          SnapCutMediaError.WAVEFORM_CANCELLED
        )
        val hooks = resourceHooks(NativeOperation.WAVEFORM, request.jobId, request.generation)
        withContext(Dispatchers.IO) {
          waveforms().generate(request, cancellation, hooks) { progress ->
            emitWaveformProgress(request, progress)
          }
        }
      }
    }

    AsyncFunction("cancelWaveform") Coroutine { jobId: String ->
      requireJobId(jobId)
      jobs.cancelAndJoin(NativeOperation.WAVEFORM, jobId)
    }

    AsyncFunction("loadSelectionPreview") Coroutine { request: LoadPreviewRequest ->
      requireCurrentPreviewRequest(request)
      try {
        preview().loadSelection(request)
      } catch (error: Throwable) {
        jobs.releasePreview(request.playbackSessionId, request.generation)
        throw error
      }
    }

    AsyncFunction("loadCompositionPreview") Coroutine { request: LoadPreviewRequest ->
      requireCurrentPreviewRequest(request)
      try {
        preview().loadComposition(request)
      } catch (error: Throwable) {
        jobs.releasePreview(request.playbackSessionId, request.generation)
        throw error
      }
    }

    AsyncFunction("playPreview") Coroutine { request: PreviewCommandRequest ->
      requireExistingPreview(request)
      preview().play(request)
    }

    AsyncFunction("pausePreview") Coroutine { request: PreviewCommandRequest ->
      requireExistingPreview(request)
      preview().pause(request)
    }

    AsyncFunction("seekPreview") Coroutine { request: SeekPreviewRequest ->
      requireExistingPreview(
        PreviewCommandRequest(
          request.playbackSessionId,
          request.generation,
          request.controlRevision
        )
      )
      if (request.positionMs < 0L) throw mediaError(SnapCutMediaError.INVALID_REQUEST)
      preview().seek(request)
    }

    AsyncFunction("releasePreview") Coroutine { request: PreviewCommandRequest ->
      if (jobs.isCurrentPreview(request.playbackSessionId, request.generation)) {
        val released = previewController?.release(request) ?: true
        if (released) jobs.releasePreview(request.playbackSessionId, request.generation)
      }
      Unit
    }

    AsyncFunction("preflightExport") Coroutine { request: ExportPreflightRequest ->
      withJob<Map<String, Any?>>(NativeOperation.PREFLIGHT, request.jobId, request.generation) {
        val coroutineJob = currentCoroutineContext().job
        val cancellation = cancellationCheck(
          NativeOperation.PREFLIGHT,
          request.jobId,
          request.generation,
          coroutineJob,
          SnapCutMediaError.EXPORT_CANCELLED
        )
        val hooks = resourceHooks(NativeOperation.PREFLIGHT, request.jobId, request.generation)
        withContext(Dispatchers.IO) {
          exports().preflight(request, cancellation, hooks) { progress ->
            emitExportProgress(
              NativeOperation.PREFLIGHT,
              request.jobId,
              request.generation,
              null,
              progress
            )
          }
        }
      }
    }

    AsyncFunction("cancelExportPreflight") Coroutine { jobId: String ->
      requireJobId(jobId)
      jobs.cancelAndJoin(NativeOperation.PREFLIGHT, jobId)
    }

    AsyncFunction("exportAudio") Coroutine { request: ExportAudioRequest ->
      try {
        withJob<Map<String, Any?>>(NativeOperation.EXPORT, request.jobId, request.generation) {
          val coroutineJob = currentCoroutineContext().job
          val cancellation = cancellationCheck(
            NativeOperation.EXPORT,
            request.jobId,
            request.generation,
            coroutineJob,
            SnapCutMediaError.EXPORT_CANCELLED
          )
          val hooks = resourceHooks(NativeOperation.EXPORT, request.jobId, request.generation)
          withContext(Dispatchers.IO) {
            exports().export(request, cancellation, hooks) { progress ->
              emitExportProgress(
                NativeOperation.EXPORT,
                request.jobId,
                request.generation,
                request.format.value,
                progress
              )
            }
          }
        }
      } finally {
        exportServices?.completeExport(request.jobId, request.generation)
      }
    }

    AsyncFunction("cancelExport") Coroutine { jobId: String ->
      requireJobId(jobId)
      val shouldCancelWorker = exportServices?.requestExportCancellation(jobId) ?: true
      if (shouldCancelWorker) {
        jobs.cancelAndJoin(NativeOperation.EXPORT, jobId)
      }
    }

    AsyncFunction("shareExport") Coroutine { request: ShareExportRequest ->
      if (destroyed.get()) throw mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE)
      withContext(Dispatchers.IO) { exports().share(request) }
    }

    OnActivityResult { _, (requestCode, resultCode, data) ->
      sourcePicker?.handleActivityResult(requestCode, resultCode, data)
    }

    OnDestroy {
      if (destroyed.compareAndSet(false, true)) {
        sourcePicker?.cancelPending()
        runCatching { previewController?.destroy() }
        jobs.cancelAll()
        exportServices?.close()
      }
    }
  }

  private suspend fun <T> withJob(
    operation: NativeOperation,
    jobId: String,
    generation: Long,
    block: suspend () -> T
  ): T {
    if (destroyed.get()) throw mediaError(SnapCutMediaError.NATIVE_FEATURE_UNAVAILABLE)
    val job = currentCoroutineContext().job
    jobs.register(operation, jobId, generation, job)
    return try {
      block()
    } catch (_: CancellationException) {
      throw mediaError(cancellationError(operation))
    } finally {
      jobs.complete(operation, jobId, generation, job)
    }
  }

  private fun cancellationError(operation: NativeOperation): SnapCutMediaError = when (operation) {
    NativeOperation.IMPORT -> SnapCutMediaError.IMPORT_CANCELLED
    NativeOperation.WAVEFORM -> SnapCutMediaError.WAVEFORM_CANCELLED
    NativeOperation.PREFLIGHT,
    NativeOperation.EXPORT -> SnapCutMediaError.EXPORT_CANCELLED
    NativeOperation.PREVIEW -> SnapCutMediaError.PREVIEW_PREPARE_FAILED
  }

  private fun requireCurrentPreviewRequest(request: LoadPreviewRequest) {
    if (
      request.clips.isEmpty() ||
      request.controlRevision < 0L ||
      !jobs.beginPreview(request.playbackSessionId, request.generation)
    ) {
      throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    }
  }

  private fun requireExistingPreview(request: PreviewCommandRequest) {
    if (
      request.controlRevision < 0L ||
      !jobs.isCurrentPreview(request.playbackSessionId, request.generation)
    ) {
      throw mediaError(SnapCutMediaError.PREVIEW_PREPARE_FAILED)
    }
  }

  private fun requireJobId(jobId: String) {
    if (jobId.isBlank()) throw mediaError(SnapCutMediaError.INVALID_REQUEST)
  }

  private fun picker(): SourcePicker = sourcePicker ?: SourcePicker(context().contentResolver).also {
    sourcePicker = it
  }

  private fun inspector(): SourceInspector = sourceInspector ?: SourceInspector(
    context().contentResolver,
    File(context().cacheDir, "SnapCut/source-spool"),
    context()
  ).also { sourceInspector = it }

  private fun mediaImporter(): MediaImportService = importService ?: MediaImportService(
    inspector(),
    stagingRoots()
  ).also { importService = it }

  private fun waveforms(): WaveformService = waveformService ?: WaveformService(
    inspector(),
    projectRoots()
  ).also { waveformService = it }

  private fun preview(): PreviewController = previewController ?: PreviewController(
    context(),
    PreviewEventSink { eventName, body -> sendEvent(eventName, body) }
  ).also { previewController = it }

  private fun exports(): SnapCutExportServices = exportServices ?: SnapCutExportServices(
    context(),
    inspector()
  ).also { exportServices = it }

  private fun mediaVerifier(): PrivateMediaVerifier = privateMediaVerifier ?: PrivateMediaVerifier(
    projectRoots() + stagingRoots()
  ).also { privateMediaVerifier = it }

  private fun stagingRoots(): List<File> = listOf(File(context().filesDir, "SnapCut/staging"))

  private fun projectRoots(): List<File> = listOf(File(context().filesDir, "SnapCut/projects"))

  private fun context() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun cancellationCheck(
    operation: NativeOperation,
    jobId: String,
    generation: Long,
    coroutineJob: kotlinx.coroutines.Job,
    error: SnapCutMediaError
  ): CancellationCheck = CancellationCheck {
    if (!coroutineJob.isActive || !jobs.isCurrent(operation, jobId, generation)) {
      throw mediaError(error)
    }
  }

  private fun resourceHooks(
    operation: NativeOperation,
    jobId: String,
    generation: Long
  ): MediaResourceHooks = object : MediaResourceHooks {
    override fun attach(resource: NativeJobResource) {
      jobs.attach(operation, jobId, generation, resource)
    }

    override fun detach(resource: NativeJobResource) {
      jobs.detach(operation, jobId, generation, resource)
    }
  }

  private fun emitImportProgress(request: ImportSourceRequest, progress: ImportProgress) {
    emitProgress(
      "onImportProgress",
      NativeOperation.IMPORT,
      request.jobId,
      request.generation,
      progress.stage.value,
      progress.fraction
    )
  }

  private fun emitInspectError(
    request: InspectSourceRequest,
    error: SnapCutMediaError,
    stage: SourceInspectionStage,
    causeCategory: String
  ) {
    sendEvent(
      "onNativeError",
      mapOf(
        "jobId" to request.jobId,
        "operation" to NativeOperation.IMPORT.value,
        "sequence" to 1L,
        "stage" to stage.value,
        "generation" to request.generation,
        "code" to error.code,
        "message" to error.safeMessage,
        "nativeStage" to stage.value,
        "causeCategory" to causeCategory
      )
    )
  }

  private fun emitImportError(
    request: ImportSourceRequest,
    error: SnapCutMediaError,
    nativeStage: String,
    causeCategory: String
  ) {
    sendEvent(
      "onNativeError",
      mapOf(
        "jobId" to request.jobId,
        "operation" to NativeOperation.IMPORT.value,
        "sequence" to 1L,
        "stage" to nativeStage,
        "generation" to request.generation,
        "code" to error.code,
        "message" to error.safeMessage,
        "nativeStage" to nativeStage,
        "causeCategory" to causeCategory
      )
    )
  }

  private fun safeImportNativeStage(
    technicalContext: String?,
    fallback: ImportStage
  ): String = technicalContext
    ?.takeIf { it in SAFE_IMPORT_NATIVE_STAGES }
    ?: fallback.value

  private fun categoryFor(error: SnapCutMediaError): String = when (error) {
    SnapCutMediaError.SOURCE_NOT_FOUND,
    SnapCutMediaError.SOURCE_PERMISSION_DENIED,
    SnapCutMediaError.SOURCE_UNREADABLE,
    SnapCutMediaError.SOURCE_TOO_LARGE -> "provider"
    SnapCutMediaError.NO_AUDIO_TRACK,
    SnapCutMediaError.M4S_INIT_MISSING,
    SnapCutMediaError.DRM_UNSUPPORTED,
    SnapCutMediaError.CORRUPT_MEDIA -> "extractor"
    SnapCutMediaError.UNSUPPORTED_MEDIA,
    SnapCutMediaError.UNSUPPORTED_AUDIO_CODEC,
    SnapCutMediaError.UNSUPPORTED_CHANNEL_COUNT -> "decoder"
    SnapCutMediaError.IMPORT_CANCELLED,
    SnapCutMediaError.JOB_ALREADY_RUNNING -> "job"
    else -> "native"
  }

  private fun emitWaveformProgress(request: GenerateWaveformRequest, progress: WaveformProgress) {
    emitProgress(
      "onWaveformProgress",
      NativeOperation.WAVEFORM,
      request.jobId,
      request.generation,
      progress.stage,
      progress.fraction
    )
  }

  private fun emitExportProgress(
    operation: NativeOperation,
    jobId: String,
    generation: Long,
    format: String?,
    progress: ExportProgress
  ) {
    if (!jobs.isCurrent(operation, jobId, generation)) return
    val sequence = runCatching { jobs.nextSequence(operation, jobId, generation) }.getOrNull()
      ?: return
    val body = mutableMapOf<String, Any?>(
      "jobId" to jobId,
      "operation" to operation.value,
      "sequence" to sequence,
      "stage" to progress.stage.value,
      "generation" to generation,
      "fraction" to progress.fraction
    )
    if (format != null) body["format"] = format
    sendEvent("onExportProgress", body)
  }

  private fun emitProgress(
    eventName: String,
    operation: NativeOperation,
    jobId: String,
    generation: Long,
    stage: String,
    fraction: Double?
  ) {
    if (!jobs.isCurrent(operation, jobId, generation)) return
    val sequence = runCatching { jobs.nextSequence(operation, jobId, generation) }.getOrNull()
      ?: return
    sendEvent(
      eventName,
      mapOf(
        "jobId" to jobId,
        "operation" to operation.value,
        "sequence" to sequence,
        "stage" to stage,
        "generation" to generation,
        "fraction" to fraction
      )
    )
  }

  private fun libraryStatus(version: String?, available: Boolean): Map<String, Any?> = mapOf(
    "version" to version,
    "available" to available
  )

  private fun classAvailable(className: String): Boolean = runCatching {
    Class.forName(className, false, javaClass.classLoader)
  }.isSuccess

  private companion object {
    const val MODULE_NAME = "SnapCutMedia"
    const val MODULE_VERSION = "1.0.0"
    val SAFE_IMPORT_NATIVE_STAGES = setOf(
      "verification_source_kind",
      "verification_codec_mime",
      "verification_sample_rate",
      "verification_channel_count",
      "verification_aac_profile",
      "verification_codec_config",
      "verification_duration"
    )
  }
}
