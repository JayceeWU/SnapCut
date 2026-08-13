package expo.modules.snapcutmedia.exportmedia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class M4aBoundaryPlannerTest {
  @Test
  fun `nearest boundary uses start-forward and end-backward tie rules`() {
    val start = NearestBoundarySelector(1_000L, BoundaryRole.START)
    val end = NearestBoundarySelector(1_000L, BoundaryRole.END)
    listOf(900L, 1_100L).forEach { boundary ->
      start.accept(boundary)
      end.accept(boundary)
    }

    assertEquals(1_100L, start.finish()!!.effectiveUs)
    assertEquals(900L, end.finish()!!.effectiveUs)
  }

  @Test
  fun `adjustment over twenty milliseconds is unavailable`() {
    val selector = NearestBoundarySelector(100_000L, BoundaryRole.START)
    selector.accept(79_999L)

    assertNull(selector.finish())
  }

  @Test
  fun `disclosed adjustment rounds symmetrically`() {
    val forward = NearestBoundarySelector(10_000L, BoundaryRole.START).apply { accept(11_001L) }
    val backward = NearestBoundarySelector(10_000L, BoundaryRole.END).apply { accept(8_999L) }

    assertEquals(2L, forward.finish()!!.adjustmentMs)
    assertEquals(-2L, backward.finish()!!.adjustmentMs)
  }
}
