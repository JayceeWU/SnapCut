import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  AppButton,
  CorruptProjectCard,
  EmptyState,
  ErrorBanner,
  PlaybackControls,
  ProjectNameModal,
  ProjectCard,
} from '@/components';
import { copy } from '@/constants';
import type { SnapCutProject } from '@/domain';

const projectFixture: SnapCutProject = {
  schemaVersion: 6,
  trackCount: 2,
  namePromptCompleted: true,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Repair me',
  createdAt: '2026-08-12T20:00:00.000Z',
  updatedAt: '2026-08-12T20:00:00.000Z',
  sources: [],
  clips: [],
  lastExport: null,
};

describe('shared UI components', () => {
  it('exposes disabled and busy button state to accessibility', async () => {
    const onPress = jest.fn();
    const screen = await render(<AppButton disabled label="Export" onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Export' });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders an actionable empty state', async () => {
    const onAction = jest.fn();
    const screen = await render(
      <EmptyState
        actionLabel={copy.projects.newAction}
        message={copy.projects.emptyMessage}
        onAction={onAction}
        title={copy.projects.emptyTitle}
      />,
    );

    expect(screen.getByRole('header', { name: copy.projects.emptyTitle })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: copy.projects.newAction }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('announces errors and permits dismissal', async () => {
    const onDismiss = jest.fn();
    const screen = await render(<ErrorBanner message="Could not save." onDismiss={onDismiss} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not save.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: copy.common.dismissError }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('validates and trims a project name before submission', async () => {
    const onSubmit = jest.fn();
    const screen = await render(
      <ProjectNameModal onCancel={jest.fn()} onSubmit={onSubmit} visible />,
    );

    await fireEvent.press(screen.getByRole('button', { name: copy.nameDialog.saveAction }));
    expect(screen.getByText(copy.nameDialog.requiredError)).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText(copy.nameDialog.fieldLabel),
      '  Purple Session  ',
    );
    await fireEvent.press(screen.getByRole('button', { name: copy.nameDialog.saveAction }));
    expect(onSubmit).toHaveBeenCalledWith('Purple Session');
  });

  it('renders compact native-clock playback state and session history actions', async () => {
    const onUndo = jest.fn();
    const onRedo = jest.fn();
    const screen = await render(
      <PlaybackControls
        available
        canRedo={false}
        canUndo
        compositionAvailable
        disabled={false}
        durationMs={12_000}
        loading={false}
        onPause={jest.fn()}
        onPlay={jest.fn()}
        onRedo={onRedo}
        onUndo={onUndo}
        playing
        positionMs={2_000}
        unavailableHint="Unavailable"
      />,
    );

    expect(screen.getByRole('button', { name: copy.editor.compositionPauseAction })).toBeTruthy();
    expect(
      StyleSheet.flatten(screen.getByTestId('composition-transport').props.style),
    ).toMatchObject({ height: 48 });
    expect(screen.getByText(copy.editor.playbackPosition('0:02', '0:12'))).toBeTruthy();
    expect(screen.queryByText(copy.editor.seekBackward)).toBeNull();
    expect(screen.queryByText(copy.editor.seekForward)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: copy.editor.undoAction }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    const redo = screen.getByRole('button', { name: copy.editor.redoAction });
    expect(redo).toBeDisabled();
    await fireEvent.press(redo);
    expect(onRedo).not.toHaveBeenCalled();
  });

  it('keeps preview disabled when the native media pipeline is unavailable', async () => {
    const onPlay = jest.fn();
    const screen = await render(
      <PlaybackControls
        available={false}
        canRedo={false}
        canUndo={false}
        compositionAvailable={false}
        disabled={false}
        durationMs={0}
        loading={false}
        onPause={jest.fn()}
        onPlay={onPlay}
        onRedo={jest.fn()}
        onUndo={jest.fn()}
        playing={false}
        positionMs={0}
        unavailableHint={copy.editor.compositionPreviewUnavailable}
      />,
    );

    const button = screen.getByRole('button', { name: copy.editor.compositionPlayAction });
    expect(button).toBeDisabled();
    expect(button.props.accessibilityHint).toBe(copy.editor.compositionPreviewUnavailable);
    await fireEvent.press(button);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('keeps Pause immediately actionable while composition loading is in progress', async () => {
    const onPause = jest.fn();
    const screen = await render(
      <PlaybackControls
        available
        canRedo={false}
        canUndo={false}
        compositionAvailable
        disabled={false}
        durationMs={12_000}
        loading
        onPause={onPause}
        onPlay={jest.fn()}
        onRedo={jest.fn()}
        onUndo={jest.fn()}
        playing={false}
        positionMs={2_000}
        unavailableHint="Unavailable"
      />,
    );

    const pause = screen.getByRole('button', { name: copy.editor.compositionPauseAction });
    expect(pause).not.toBeDisabled();
    await fireEvent.press(pause);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('keeps history available when undo or redo produces an empty timeline', async () => {
    const onUndo = jest.fn();
    const onRedo = jest.fn();
    const screen = await render(
      <PlaybackControls
        available
        canRedo
        canUndo
        compositionAvailable={false}
        disabled={false}
        durationMs={0}
        loading={false}
        onPause={jest.fn()}
        onPlay={jest.fn()}
        onRedo={onRedo}
        onUndo={onUndo}
        playing={false}
        positionMs={0}
        unavailableHint="Unavailable"
      />,
    );

    expect(screen.getByRole('button', { name: copy.editor.compositionPlayAction })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: copy.editor.undoAction }));
    await fireEvent.press(screen.getByRole('button', { name: copy.editor.redoAction }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('keeps repair projects visible but prevents opening invalid media', async () => {
    const onOpen = jest.fn();
    const screen = await render(
      <ProjectCard
        onDelete={jest.fn()}
        onOpen={onOpen}
        onRename={jest.fn()}
        project={projectFixture}
        repairStatus={{
          state: 'needs-repair',
          issues: ['PRIVATE_MEDIA_MISSING_OR_EMPTY'],
        }}
      />,
    );

    expect(screen.getByText(copy.projects.repairTitle)).toBeTruthy();
    expect(
      screen.getByText(copy.projects.repairIssue('PRIVATE_MEDIA_MISSING_OR_EMPTY')),
    ).toBeTruthy();
    const openButton = screen.getByRole('button', { name: projectFixture.name });
    expect(openButton).toBeDisabled();
    await fireEvent.press(openButton);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers deletion for a preserved corrupt project directory', async () => {
    const onDelete = jest.fn();
    const screen = await render(
      <CorruptProjectCard onDelete={onDelete} projectId="corrupt-project" />,
    );

    expect(screen.getByRole('header', { name: copy.projects.corruptTitle })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: copy.projects.deleteAction }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
