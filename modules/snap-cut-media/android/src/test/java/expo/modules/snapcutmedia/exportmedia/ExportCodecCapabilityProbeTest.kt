package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.codec.NativeCodecBuildInfo
import expo.modules.snapcutmedia.codec.NativeCodecLibraryStatus
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExportCodecCapabilityProbeTest {
  @Test
  fun nativeBridgeProbeFailureDoesNotHideIndependentAacEncoder() {
    val result = SnapCutExportServices.probeCodecCapabilities(
      buildInfo = { throw UnsatisfiedLinkError("not exposed") },
      aacAvailable = { true }
    )

    assertTrue(result.aacAvailable)
    assertFalse(result.flacAvailable)
    assertFalse(result.mp3Available)
    assertFalse(result.resamplerAvailable)
  }

  @Test
  fun aacProbeFailureDoesNotHideNativeEncoders() {
    val available = NativeCodecLibraryStatus("test", true)
    val result = SnapCutExportServices.probeCodecCapabilities(
      buildInfo = {
        NativeCodecBuildInfo(
          bridgeLoaded = true,
          flac = available,
          lame = available,
          libsamplerate = available
        )
      },
      aacAvailable = { throw IllegalStateException("not exposed") }
    )

    assertFalse(result.aacAvailable)
    assertTrue(result.flacAvailable)
    assertTrue(result.mp3Available)
    assertTrue(result.resamplerAvailable)
  }
}
