package expo.modules.snapcutmedia.waveform

internal data class WaveformProgress(val stage: String, val fraction: Double?)

internal class WaveformProgressReporter(
  private val sink: (WaveformProgress) -> Unit,
  private val clockMs: () -> Long = { android.os.SystemClock.elapsedRealtime() }
) {
  private var lastEmissionMs = Long.MIN_VALUE

  fun report(stage: String, fraction: Double?, force: Boolean = false) {
    val now = clockMs()
    if (!force && lastEmissionMs != Long.MIN_VALUE && now - lastEmissionMs < 250L) return
    lastEmissionMs = now
    sink(WaveformProgress(stage, fraction?.takeIf(Double::isFinite)?.coerceIn(0.0, 1.0)))
  }
}
