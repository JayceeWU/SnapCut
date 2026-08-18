package expo.modules.snapcutmedia.codec

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeCodecBridgeInstrumentedTest {
  @Test
  fun reportsPinnedRuntimeVersionsAndClosesNativeHandlesIdempotently() {
    val info = NativeCodecBridge.getBuildInfo()
    assertTrue(info.bridgeLoaded)
    assertEquals("4.0", info.lame.version)
    assertEquals("0.2.2", info.libsamplerate.version)
    assertTrue(info.lame.available)
    assertTrue(info.libsamplerate.available)

    val handle = NativeCodecBridge.createSmokeHandle()
    assertTrue(handle > 0L)
    assertEquals(NativeHandleCloseResult.CLOSED, NativeCodecBridge.closeSmokeHandle(handle))
    assertEquals(
      NativeHandleCloseResult.ALREADY_CLOSED_OR_UNKNOWN,
      NativeCodecBridge.closeSmokeHandle(handle)
    )
  }
}
