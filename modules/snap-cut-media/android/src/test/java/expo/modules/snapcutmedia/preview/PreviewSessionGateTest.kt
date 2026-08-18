package expo.modules.snapcutmedia.preview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PreviewSessionGateTest {
  @Test
  fun `new generation supersedes prior callbacks and commands`() {
    val gate = PreviewSessionGate()
    val first = gate.begin("first-session", 4L)!!
    val second = gate.begin("second-session", 5L)!!

    assertFalse(gate.isCurrent(first))
    assertTrue(gate.isCurrent(second))
    assertFalse(gate.release(first))
    assertTrue(gate.isCurrent(second))
  }

  @Test
  fun `stale or same generation different sessions stay rejected after release`() {
    val gate = PreviewSessionGate()
    val current = gate.begin("current-session", 8L)!!

    assertNull(gate.begin("stale-session", 7L))
    assertTrue(gate.release(current))
    assertNull(gate.begin("different-session", 8L))
    assertEquals(current, gate.begin("current-session", 8L))
  }

  @Test
  fun `invalid tokens are rejected and destroy clear resets the gate`() {
    val gate = PreviewSessionGate()

    assertNull(gate.begin("", 1L))
    assertNull(gate.begin("session", -1L))
    assertNull(gate.begin("session", 1L, -1L))
    assertTrue(gate.begin("before-destroy", 20L) != null)
    gate.clear()
    assertTrue(gate.begin("after-destroy", 0L) != null)
  }

  @Test
  fun `control revisions reject stale commands and allow one intent to seek then play`() {
    val gate = PreviewSessionGate()
    val token = gate.begin("session", 3L, 4L)!!

    assertEquals(4L, gate.currentControlRevision(token))
    assertTrue(gate.acceptControl(token, 5L))
    assertTrue(gate.acceptControl(token, 5L))
    assertFalse(gate.acceptControl(token, 4L))
    assertNull(gate.begin("session", 3L, 4L))
    assertEquals(5L, gate.currentControlRevision(token))
  }

  @Test
  fun `native interruption advances the active control revision only`() {
    val gate = PreviewSessionGate()
    val stale = gate.begin("stale", 1L, 2L)!!
    val current = gate.begin("current", 2L, 7L)!!

    assertNull(gate.advanceControl(stale))
    assertEquals(8L, gate.advanceControl(current))
    assertEquals(8L, gate.currentControlRevision(current))
  }
}
