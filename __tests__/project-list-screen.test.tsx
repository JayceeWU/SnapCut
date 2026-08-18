import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

import ProjectListScreen from '../app/index';
import { copy } from '@/constants';
import type { SnapCutProject } from '@/domain';
import { configureProjectRepository, type ProjectRepositoryPort, useProjectStore } from '@/stores';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

function automaticProject(): SnapCutProject {
  return {
    schemaVersion: 9,
    crossfades: [],
    sourceComparisons: [],
    id: '11111111-1111-4111-8111-111111111111',
    name: '2026-08-13 14-30-25',
    namePromptCompleted: false,
    createdAt: '2026-08-13T21:30:25.000Z',
    updatedAt: '2026-08-13T21:30:25.000Z',
    sources: [],
    clips: [],
    lastExport: null,
  };
}

function repository(
  create: ProjectRepositoryPort['create'],
  overrides: Partial<ProjectRepositoryPort> = {},
): ProjectRepositoryPort {
  return {
    initialize: jest.fn(),
    list: jest.fn(() => []),
    get: jest.fn(() => null),
    create,
    save: jest.fn((project: SnapCutProject) => project),
    rename: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
}

describe('project list automatic creation', () => {
  beforeEach(() => {
    mockPush.mockReset();
    useProjectStore.getState().reset();
  });

  it('keeps the SnapCut brand in one text line on a narrow screen', async () => {
    configureProjectRepository(repository(jest.fn()));
    const screen = await render(<ProjectListScreen />);
    await waitFor(() => expect(screen.getByRole('header', { name: 'SnapCut' })).toBeTruthy());

    const heading = screen.getByRole('header', { name: 'SnapCut' });
    expect(heading.props.children).toBe('SnapCut');
    expect(heading.props.numberOfLines).toBe(1);
  });

  it('creates once without showing a name field and opens the editor', async () => {
    let finishCreate: ((project: SnapCutProject) => void) | undefined;
    const create = jest.fn(
      () =>
        new Promise<SnapCutProject>((resolve) => {
          finishCreate = resolve;
        }),
    );
    configureProjectRepository(repository(create));
    const screen = await render(<ProjectListScreen />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'New Project' })).toHaveLength(2),
    );

    const button = screen.getAllByRole('button', { name: 'New Project' })[0]!;
    expect(screen.queryByLabelText('Project name')).toBeNull();
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({});

    finishCreate?.(automaticProject());
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/project/[id]',
        params: { id: automaticProject().id },
      }),
    );
  });

  it('restores the create action and stays on the list after a failure', async () => {
    const create = jest.fn(async () => {
      throw new Error('private failure');
    });
    configureProjectRepository(repository(create));
    const screen = await render(<ProjectListScreen />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'New Project' })).toHaveLength(2),
    );

    await fireEvent.press(screen.getAllByRole('button', { name: 'New Project' })[0]!);

    await waitFor(() => expect(screen.getByText('The project could not be created.')).toBeTruthy());
    expect(screen.getAllByRole('button', { name: 'New Project' })[0]).toBeEnabled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps a failed rename visible inside the rename dialog', async () => {
    const project = automaticProject();
    configureProjectRepository(
      repository(jest.fn(), {
        list: jest.fn(() => [project]),
        rename: jest.fn(async () => {
          throw new Error('private failure');
        }),
      }),
    );
    const screen = await render(<ProjectListScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Rename' }));
    await fireEvent.changeText(screen.getByLabelText(copy.nameDialog.fieldLabel), 'New name');
    await fireEvent.press(screen.getByRole('button', { name: copy.nameDialog.saveAction }));

    const dialog = screen.getByTestId('project-name-dialog');
    await waitFor(() => expect(within(dialog).getByText(copy.projects.renameError)).toBeTruthy());
    expect(within(dialog).getByRole('alert')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('keeps a failed delete visible inside the delete dialog', async () => {
    const project = automaticProject();
    configureProjectRepository(
      repository(jest.fn(), {
        list: jest.fn(() => [project]),
        delete: jest.fn(async () => {
          throw new Error('private failure');
        }),
      }),
    );
    const screen = await render(<ProjectListScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.press(screen.getByRole('button', { name: copy.deleteDialog.confirmAction }));

    const dialog = screen.getByTestId('confirm-delete-dialog');
    await waitFor(() => expect(within(dialog).getByText(copy.projects.deleteError)).toBeTruthy());
    expect(within(dialog).getByRole('alert')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
