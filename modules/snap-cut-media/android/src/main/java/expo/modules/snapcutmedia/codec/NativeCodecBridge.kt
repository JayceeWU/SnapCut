package expo.modules.snapcutmedia.codec

internal data class NativeCodecLibraryStatus(
  val version: String?,
  val available: Boolean
)

internal data class NativeCodecBuildInfo(
  val bridgeLoaded: Boolean,
  val lame: NativeCodecLibraryStatus,
  val libsamplerate: NativeCodecLibraryStatus
)

internal enum class NativeHandleCloseResult(val nativeCode: Int) {
  CLOSED(0),
  ALREADY_CLOSED_OR_UNKNOWN(1),
  NATIVE_UNAVAILABLE(-1);

  companion object {
    fun fromNativeCode(code: Int): NativeHandleCloseResult = entries.firstOrNull {
      it.nativeCode == code
    } ?: ALREADY_CLOSED_OR_UNKNOWN
  }
}
/** JNI boundary registered from JNI_OnLoad; no name-based JNI exports. */
internal object NativeCodecBridge {
  private val loadFailure: Throwable? = runCatching {
    System.loadLibrary(LIBRARY_NAME)
  }.exceptionOrNull()

  val isLoaded: Boolean
    get() = loadFailure == null

  fun getBuildInfo(): NativeCodecBuildInfo {
    if (!isLoaded) return unavailableBuildInfo()

    val lameVersion = nativeVersionOrNull(::nativeLameVersion)
    val sampleRateVersion = nativeVersionOrNull(::nativeSampleRateVersion)
    val smokeAvailable = probeCodecLifecycle()

    return NativeCodecBuildInfo(
      bridgeLoaded = true,
      lame = NativeCodecLibraryStatus(lameVersion, smokeAvailable && lameVersion != null),
      libsamplerate = NativeCodecLibraryStatus(
        sampleRateVersion,
        smokeAvailable && sampleRateVersion != null
      )
    )
  }

  internal fun createSmokeHandle(): Long = if (isLoaded) {
    runCatching { nativeCreateSmokeHandle() }.getOrDefault(INVALID_HANDLE)
  } else {
    INVALID_HANDLE
  }

  internal fun closeSmokeHandle(handle: Long): NativeHandleCloseResult {
    if (!isLoaded) return NativeHandleCloseResult.NATIVE_UNAVAILABLE
    return runCatching {
      NativeHandleCloseResult.fromNativeCode(nativeCloseSmokeHandle(handle))
    }.getOrDefault(NativeHandleCloseResult.NATIVE_UNAVAILABLE)
  }

  private fun probeCodecLifecycle(): Boolean {
    val handle = createSmokeHandle()
    if (handle <= INVALID_HANDLE) return false
    return closeSmokeHandle(handle) == NativeHandleCloseResult.CLOSED
  }

  private fun nativeVersionOrNull(readVersion: () -> String): String? = runCatching {
    readVersion().trim().takeIf(String::isNotEmpty)
  }.getOrNull()

  private fun unavailableBuildInfo() = NativeCodecBuildInfo(
    bridgeLoaded = false,
    lame = NativeCodecLibraryStatus(version = null, available = false),
    libsamplerate = NativeCodecLibraryStatus(version = null, available = false)
  )

  private external fun nativeLameVersion(): String
  private external fun nativeSampleRateVersion(): String
  private external fun nativeCreateSmokeHandle(): Long
  private external fun nativeCloseSmokeHandle(handle: Long): Int

  private const val LIBRARY_NAME = "snapcut_codec"
  private const val INVALID_HANDLE = 0L
}
