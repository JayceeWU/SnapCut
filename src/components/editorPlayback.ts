export interface PauseAcknowledgementState {
  projectId: string | null;
  mode: 'selection' | 'composition' | null;
  desiredPlaying: boolean;
  pausePending: boolean;
  controlRevision: number;
  positionMs: number;
}

export function acknowledgedCompositionPausePosition(
  requestedInteractionRevision: number,
  currentInteractionRevision: number,
  requestedControlRevision: number,
  projectId: string,
  playback: PauseAcknowledgementState,
): number | null {
  if (
    requestedInteractionRevision !== currentInteractionRevision ||
    playback.projectId !== projectId ||
    playback.mode !== 'composition' ||
    playback.desiredPlaying ||
    playback.pausePending ||
    playback.controlRevision !== requestedControlRevision
  ) {
    return null;
  }
  return playback.positionMs;
}
