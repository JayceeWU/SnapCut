export const editorWorkspaceLayout = {
  minimumTouchHeight: 48,
  contentVerticalPadding: 4,
  headerHeight: 52,
  sectionGap: 4,
  transportHeight: 58,
  transportControlHeight: 48,
  timelineStageHeight: 248,
  timelineRulerHeight: 80,
  timelineTrackHeight: 56,
  timelineLowerScrubHeight: 56,
  overviewHeight: 48,
  actionRailHeight: 58,
  volumePanelHeight: 58,
  fadePanelHeight: 110,
  inlineSliderHeight: 48,
} as const;

export const mate20EditorBudget = {
  viewportHeight: 748,
  reservedSystemAndSafeAreaHeight: 108,
  safeWorkspaceHeight: 640,
} as const;

export const selectedFadeWorkspaceHeight =
  editorWorkspaceLayout.contentVerticalPadding * 2 +
  editorWorkspaceLayout.headerHeight +
  editorWorkspaceLayout.transportHeight +
  editorWorkspaceLayout.timelineStageHeight +
  editorWorkspaceLayout.overviewHeight +
  editorWorkspaceLayout.actionRailHeight +
  editorWorkspaceLayout.fadePanelHeight +
  editorWorkspaceLayout.sectionGap * 5;
