import type { SnapCutProject } from '@/domain';
import {
  configureProjectReleasePort,
  configureProjectRepository,
  type ProjectRepositoryPort,
  useProjectStore,
} from '@/stores';

const createFixture = (id: string, name: string, updatedAt: string): SnapCutProject => ({
  schemaVersion: 7,
  namePromptCompleted: true,
  id,
  name,
  createdAt: updatedAt,
  updatedAt,
  sources: [],
  clips: [],
  lastExport: null,
});

function createFakeRepository(seed: SnapCutProject[] = []): ProjectRepositoryPort {
  const projects = new Map(seed.map((project) => [project.id, project]));
  let nextId = seed.length + 1;

  return {
    initialize: jest.fn(),
    list: jest.fn(() => [...projects.values()]),
    get: jest.fn((id: string) => projects.get(id) ?? null),
    save: jest.fn((project: SnapCutProject) => {
      projects.set(project.id, project);
      return project;
    }),
    create: jest.fn((options: { name?: string | null } = {}) => {
      const project = createFixture(
        `project-${nextId++}`,
        options.name ?? '2026-08-12 13-00-00',
        '2026-08-12T20:00:00.000Z',
      );
      project.namePromptCompleted = options.name !== undefined;
      projects.set(project.id, project);
      return project;
    }),
    rename: jest.fn((id: string, name: string) => {
      const existing = projects.get(id);
      if (!existing) throw new Error('missing');
      const project = { ...existing, name, updatedAt: '2026-08-12T21:00:00.000Z' };
      projects.set(id, project);
      return project;
    }),
    renameSource: jest.fn((projectId: string, sourceId: string, displayName: string) => {
      const existing = projects.get(projectId);
      if (!existing) throw new Error('missing');
      const project = {
        ...existing,
        sources: existing.sources.map((source) =>
          source.id === sourceId ? { ...source, displayName } : source,
        ),
      };
      projects.set(projectId, project);
      return project;
    }),
    deleteSource: jest.fn((projectId: string, sourceId: string) => {
      const existing = projects.get(projectId);
      if (!existing) throw new Error('missing');
      const project = {
        ...existing,
        sources: existing.sources.filter(({ id }) => id !== sourceId),
      };
      projects.set(projectId, project);
      return project;
    }),
    delete: jest.fn((id: string) => {
      projects.delete(id);
    }),
  };
}

describe('project store repository coordination', () => {
  beforeEach(() => {
    configureProjectReleasePort(null);
    useProjectStore.getState().reset();
  });

  it('loads projects newest first and initializes only once', async () => {
    const older = createFixture('older', 'Older', '2026-08-10T20:00:00.000Z');
    const newer = createFixture('newer', 'Newer', '2026-08-12T20:00:00.000Z');
    const repository = createFakeRepository([older, newer]);
    configureProjectRepository(repository);

    await useProjectStore.getState().loadProjects();
    await useProjectStore.getState().loadProjects();

    expect(useProjectStore.getState().projects.map(({ id }) => id)).toEqual(['newer', 'older']);
    expect(repository.initialize).toHaveBeenCalledTimes(1);
  });

  it('creates, renames, and deletes through the repository', async () => {
    const repository = createFakeRepository();
    configureProjectRepository(repository);

    const project = await useProjectStore.getState().createProject('Field Notes');
    expect(project?.name).toBe('Field Notes');

    expect(await useProjectStore.getState().renameProject(project!.id, 'Final Cut')).toBe(true);
    expect(useProjectStore.getState().projects[0]?.name).toBe('Final Cut');

    expect(await useProjectStore.getState().deleteProject(project!.id)).toBe(true);
    expect(useProjectStore.getState().projects).toHaveLength(0);
  });

  it('creates an automatically named project without passing a name', async () => {
    const repository = createFakeRepository();
    configureProjectRepository(repository);

    const project = await useProjectStore.getState().createProject();

    expect(repository.create).toHaveBeenCalledWith({});
    expect(project).toMatchObject({
      name: '2026-08-12 13-00-00',
      namePromptCompleted: false,
    });
  });

  it('maps repository failures to stable user copy and releases mutation state', async () => {
    const repository = createFakeRepository();
    repository.create = jest.fn(() => {
      throw new Error('private diagnostic');
    });
    configureProjectRepository(repository);

    expect(await useProjectStore.getState().createProject('Failed')).toBeNull();
    expect(useProjectStore.getState().error).toBe('The project could not be created.');
    expect(useProjectStore.getState().mutation).toBeNull();
  });

  it('renames and deletes a source through dedicated repository actions', async () => {
    const project: SnapCutProject = {
      ...createFixture('project', 'Sources', '2026-08-12T20:00:00.000Z'),
      sources: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          displayName: 'Source 1',
          originalMimeType: null,
          sourceKind: 'm4a',
          privateAudioFileName: 'source.m4a',
          durationMs: 1_000,
          codecMime: 'audio/mp4a-latm',
          sampleRateHz: 48_000,
          channelCount: 2,
          encodedBitrateBps: 192_000,
          pcmBitsPerSample: null,
          aacProfile: 'aac-lc',
          codecConfigFingerprint: null,
          encoderDelayFrames: null,
          encoderPaddingFrames: null,
          privateAudioSha256: null,
          fileSizeBytes: 1_024,
          waveformFileName: 'waveform.json',
          waveformStatus: 'pending',
          createdAt: '2026-08-12T20:00:00.000Z',
        },
      ],
    };
    const repository = createFakeRepository([project]);
    repository.getRepairStatus = jest
      .fn()
      .mockReturnValueOnce({
        state: 'needs-repair',
        issues: ['PRIVATE_MEDIA_MISSING_OR_EMPTY'],
      })
      .mockReturnValueOnce({ state: 'ready', issues: [] });
    configureProjectRepository(repository);
    await useProjectStore.getState().loadProject(project.id);
    expect(useProjectStore.getState().repairStatuses[project.id]?.state).toBe('needs-repair');

    expect(
      await useProjectStore.getState().renameSource(project.id, project.sources[0]!.id, 'Voice'),
    ).toBe(true);
    expect(useProjectStore.getState().activeProject?.sources[0]?.displayName).toBe('Voice');
    expect(await useProjectStore.getState().deleteSource(project.id, project.sources[0]!.id)).toBe(
      true,
    );
    expect(useProjectStore.getState().activeProject?.sources).toEqual([]);
    expect(repository.getRepairStatus).toHaveBeenCalledTimes(2);
    expect(useProjectStore.getState().repairStatuses[project.id]).toEqual({
      state: 'ready',
      issues: [],
    });
  });

  it('shows a stable source-in-use message without leaking repository detail', async () => {
    const project = createFixture('project', 'Sources', '2026-08-12T20:00:00.000Z');
    const repository = createFakeRepository([project]);
    repository.deleteSource = jest.fn(() => {
      throw Object.assign(new Error('private paths'), { code: 'SOURCE_IN_USE' });
    });
    configureProjectRepository(repository);

    expect(await useProjectStore.getState().deleteSource(project.id, 'source')).toBe(false);
    expect(useProjectStore.getState().error).toBe('Remove clips that use this source first.');
    expect(useProjectStore.getState().mutation).toBeNull();
  });

  it('serializes updates and applies each updater to the latest repository snapshot', async () => {
    const project = createFixture('project', 'Base', '2026-08-12T20:00:00.000Z');
    const repository = createFakeRepository([project]);
    configureProjectRepository(repository);
    await useProjectStore.getState().loadProjects();

    const first = useProjectStore
      .getState()
      .updateProject(project.id, (current) => ({ ...current, name: `${current.name} A` }));
    const second = useProjectStore
      .getState()
      .updateProject(project.id, (current) => ({ ...current, name: `${current.name} B` }));

    await Promise.all([first, second]);

    expect(useProjectStore.getState().projects[0]?.name).toBe('Base A B');
    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(useProjectStore.getState().mutation).toBeNull();
  });

  it('awaits preview release before deleting project files', async () => {
    const project = createFixture('project', 'Previewing', '2026-08-12T20:00:00.000Z');
    const repository = createFakeRepository([project]);
    const order: string[] = [];
    repository.delete = jest.fn(async () => {
      order.push('delete');
    });
    configureProjectRepository(repository);
    configureProjectReleasePort({
      releaseProject: jest.fn(async () => {
        order.push('release');
      }),
    });
    await useProjectStore.getState().loadProjects();

    expect(await useProjectStore.getState().deleteProject(project.id)).toBe(true);
    expect(order).toEqual(['release', 'delete']);
  });

  it('surfaces repair states and can delete preserved corrupt directories', async () => {
    const project = createFixture('project', 'Needs repair', '2026-08-12T20:00:00.000Z');
    const repository = createFakeRepository([project]);
    repository.getRepairStatus = jest.fn(() => ({
      state: 'needs-repair',
      issues: ['PRIVATE_MEDIA_MISSING_OR_EMPTY'],
    }));
    repository.listCorruptProjectIds = jest.fn(() => ['corrupt-project']);
    repository.deleteCorruptProject = jest.fn();
    configureProjectRepository(repository);

    await useProjectStore.getState().loadProjects();

    expect(useProjectStore.getState().repairStatuses[project.id]).toEqual({
      state: 'needs-repair',
      issues: ['PRIVATE_MEDIA_MISSING_OR_EMPTY'],
    });
    expect(useProjectStore.getState().corruptProjectIds).toEqual(['corrupt-project']);
    expect(await useProjectStore.getState().deleteCorruptProject('corrupt-project')).toBe(true);
    expect(repository.deleteCorruptProject).toHaveBeenCalledWith('corrupt-project');
    expect(useProjectStore.getState().corruptProjectIds).toEqual([]);
  });
});
