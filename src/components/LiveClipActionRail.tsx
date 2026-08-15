import type { SnapCutClip } from '@/domain';
import { usePlaybackStore } from '@/stores';
import { canSplitClipAtTimelinePosition } from '@/utils';

import { ClipActionRail } from './ClipActionRail';

export interface LiveClipActionRailProps {
  disabled?: boolean;
  fallbackCursorMs: number;
  onDelete: () => void;
  onFade: () => void;
  onSplit: () => void;
  onVolume: () => void;
  projectId: string;
  selectedClip: SnapCutClip | null;
}

export function LiveClipActionRail({
  disabled = false,
  fallbackCursorMs,
  onDelete,
  onFade,
  onSplit,
  onVolume,
  projectId,
  selectedClip,
}: LiveClipActionRailProps) {
  const splitCursorMs = usePlaybackStore((state) =>
    state.projectId === projectId &&
    state.mode === 'composition' &&
    (state.desiredPlaying || state.playing)
      ? state.positionMs
      : fallbackCursorMs,
  );
  const splitEnabled =
    selectedClip !== null && canSplitClipAtTimelinePosition(selectedClip, splitCursorMs);

  return (
    <ClipActionRail
      disabled={disabled}
      onDelete={onDelete}
      onFade={onFade}
      onSplit={onSplit}
      onVolume={onVolume}
      splitEnabled={splitEnabled}
      visible={selectedClip !== null}
    />
  );
}
