package expo.modules.snapcutmedia.preview

/** Keeps the pause side effects in a deterministic order that can be unit tested without ExoPlayer. */
internal class PreviewPauseCoordinator {
  fun pause(
    trackCount: Int,
    stopProgressTicker: () -> Unit,
    clearResumeIntent: () -> Unit,
    pauseTrack: (Int) -> Unit,
    abandonAudioFocus: () -> Unit,
    acknowledgePaused: () -> Unit
  ) {
    require(trackCount >= 0)
    stopProgressTicker()
    clearResumeIntent()
    repeat(trackCount) { index -> pauseTrack(index) }
    abandonAudioFocus()
    acknowledgePaused()
  }
}
