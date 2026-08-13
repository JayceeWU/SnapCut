import { fireEvent, render } from '@testing-library/react-native';

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
  schemaVersion: 3,
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

  it('renders native-clock playback state and forwards seek commands', async () => {
    const onSeek = jest.fn();
    const screen = await render(
      <PlaybackControls
        activeMode="selection"
        available
        disabled={false}
        durationMs={12_000}
        loaded
        loading={false}
        mode="selection"
        onSeek={onSeek}
        onToggle={jest.fn()}
        playing
        positionMs={2_000}
        unavailableHint="Unavailable"
      />,
    );

    expect(screen.getByRole('button', { name: copy.editor.selectionPauseAction })).toBeTruthy();
    expect(screen.getByText(copy.editor.playbackPosition('0:02', '0:12'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: copy.editor.seekForward }));
    expect(onSeek).toHaveBeenCalledWith(7_000);
  });

  it('keeps preview disabled when the native media pipeline is unavailable', async () => {
    const onToggle = jest.fn();
    const screen = await render(
      <PlaybackControls
        activeMode={null}
        available={false}
        disabled={false}
        durationMs={0}
        loaded={false}
        loading={false}
        mode="composition"
        onSeek={jest.fn()}
        onToggle={onToggle}
        playing={false}
        positionMs={0}
        unavailableHint={copy.editor.compositionPreviewUnavailable}
      />,
    );

    const button = screen.getByRole('button', { name: copy.editor.compositionPlayAction });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onToggle).not.toHaveBeenCalled();
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
