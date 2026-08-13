package expo.modules.snapcutmedia.exportmedia

internal enum class BoundaryRole { START, END }

internal data class PlannedBoundary(
  val effectiveUs: Long,
  val adjustmentUs: Long,
  val adjustmentMs: Long
)

/** Retains one value per requested endpoint, never the full AAC sample table. */
internal class NearestBoundarySelector(
  private val requestedUs: Long,
  private val role: BoundaryRole
) {
  private var bestUs: Long? = null
  private var bestDistanceUs = Long.MAX_VALUE

  init {
    require(requestedUs >= 0L)
  }

  fun accept(boundaryUs: Long) {
    require(boundaryUs >= 0L)
    val distance = absoluteDifference(boundaryUs, requestedUs)
    val current = bestUs
    val winsTie = distance == bestDistanceUs && current != null && when (role) {
      BoundaryRole.START -> boundaryUs > current
      BoundaryRole.END -> boundaryUs < current
    }
    if (distance < bestDistanceUs || winsTie) {
      bestUs = boundaryUs
      bestDistanceUs = distance
    }
  }

  fun finish(maxAdjustmentUs: Long = MAX_M4A_ADJUSTMENT_US): PlannedBoundary? {
    val selected = bestUs ?: return null
    if (bestDistanceUs > maxAdjustmentUs) return null
    val adjustmentUs = selected - requestedUs
    return PlannedBoundary(selected, adjustmentUs, roundedMilliseconds(adjustmentUs))
  }

  private fun absoluteDifference(left: Long, right: Long): Long = try {
    val difference = Math.subtractExact(left, right)
    if (difference == Long.MIN_VALUE) Long.MAX_VALUE else kotlin.math.abs(difference)
  } catch (_: ArithmeticException) {
    Long.MAX_VALUE
  }

  private fun roundedMilliseconds(valueUs: Long): Long = if (valueUs >= 0L) {
    (valueUs + 999L) / 1000L
  } else {
    -((-valueUs + 999L) / 1000L)
  }

  companion object {
    const val MAX_M4A_ADJUSTMENT_US = 20_000L
  }
}
