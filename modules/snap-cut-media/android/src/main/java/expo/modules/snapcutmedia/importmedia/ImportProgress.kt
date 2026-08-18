package expo.modules.snapcutmedia.importmedia

internal enum class ImportStage(val value: String) {
  INSPECTING("inspecting"),
  EXTRACTING_OR_COPYING("extracting_or_copying"),
  VERIFYING("verifying"),
  COMMITTING("committing"),
  COMPLETE("complete")
}

internal data class ImportProgress(
  val stage: ImportStage,
  val fraction: Double?,
  val bytesProcessed: Long?,
  val totalBytes: Long?
)

internal class ImportProgressReporter(
  private val sink: (ImportProgress) -> Unit,
  private val clockMs: () -> Long = { android.os.SystemClock.elapsedRealtime() }
) {
  private var lastStage: ImportStage? = null
  private var lastEmissionMs = Long.MIN_VALUE

  fun report(
    stage: ImportStage,
    fraction: Double?,
    bytesProcessed: Long? = null,
    totalBytes: Long? = null,
    force: Boolean = false
  ) {
    val now = clockMs()
    if (!force && stage == lastStage && lastEmissionMs != Long.MIN_VALUE && now - lastEmissionMs < 100L) {
      return
    }
    lastStage = stage
    lastEmissionMs = now
    sink(
      ImportProgress(
        stage,
        fraction?.takeIf(Double::isFinite)?.coerceIn(0.0, 1.0),
        bytesProcessed?.takeIf { it >= 0L },
        totalBytes?.takeIf { it > 0L }
      )
    )
  }
}
