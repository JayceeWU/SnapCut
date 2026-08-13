import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ProjectListScreen from '../app/index';
import type { SnapCutProject } from '@/domain';
import { configureProjectRepository, type ProjectRepositoryPort, useProjectStore } from '@/stores';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

function automaticProject(): SnapCutProject {
  return {
    schemaVersion: 3,
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

function repository(create: ProjectRepositoryPort['create']): ProjectRepositoryPort {
  return {
    initialize: jest.fn(),
    list: jest.fn(() => []),
    get: jest.fn(() => null),
    create,
    save: jest.fn((project: SnapCutProject) => project),
    rename: jest.fn(),
    delete: jest.fn(),
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
});
