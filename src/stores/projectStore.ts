import { create } from 'zustand';

import { copy } from '@/constants';
import type { SnapCutProject } from '@/domain/types';
import type { ProjectRepairStatus } from '@/services/RecoveryService';

type MaybePromise<T> = T | Promise<T>;

/** The narrow repository boundary used by screens and injected by app startup/tests. */
export interface ProjectRepositoryPort {
  initialize(): MaybePromise<void>;
  list(): MaybePromise<SnapCutProject[]>;
  get(id: string): MaybePromise<SnapCutProject | null>;
  create(options?: { name?: string | null }): MaybePromise<SnapCutProject>;
  save(project: SnapCutProject): MaybePromise<SnapCutProject>;
  rename(id: string, name: string): MaybePromise<SnapCutProject>;
  renameSource?(
    projectId: string,
    sourceId: string,
    displayName: string,
  ): MaybePromise<SnapCutProject>;
  deleteSource?(projectId: string, sourceId: string): MaybePromise<SnapCutProject>;
  delete(id: string): MaybePromise<void>;
  getRepairStatus?(id: string): MaybePromise<ProjectRepairStatus | null>;
  listCorruptProjectIds?(): MaybePromise<string[]>;
  deleteCorruptProject?(id: string): MaybePromise<void>;
}

export type ProjectMutation =
  'create' | 'rename' | 'rename-source' | 'delete-source' | 'delete' | 'save';
export type ProjectUpdater = (project: SnapCutProject) => SnapCutProject;

export interface ProjectReleasePort {
  releaseProject(projectId: string): Promise<void>;
}

interface ProjectStoreState {
  projects: SnapCutProject[];
  repairStatuses: Record<string, ProjectRepairStatus>;
  corruptProjectIds: string[];
  activeProject: SnapCutProject | null;
  loadingList: boolean;
  loadingProject: boolean;
  initialized: boolean;
  mutation: ProjectMutation | null;
  error: string | null;
  configureRepository: (repository: ProjectRepositoryPort) => void;
  loadProjects: () => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  createProject: (name?: string | null) => Promise<SnapCutProject | null>;
  renameProject: (projectId: string, name: string) => Promise<boolean>;
  renameSource: (projectId: string, sourceId: string, name: string) => Promise<boolean>;
  deleteSource: (projectId: string, sourceId: string) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<boolean>;
  deleteCorruptProject: (projectId: string) => Promise<boolean>;
  updateProject: (projectId: string, update: ProjectUpdater) => Promise<SnapCutProject | null>;
  clearActiveProject: () => void;
  clearError: () => void;
  reset: () => void;
}

let projectRepository: ProjectRepositoryPort | null = null;
let projectReleasePort: ProjectReleasePort | null = null;
let initialization: Promise<void> | null = null;
const projectWriteQueues = new Map<string, Promise<void>>();
let activeProjectWrites = 0;

function requireRepository(): ProjectRepositoryPort {
  if (!projectRepository) {
    throw new Error('Project repository has not been configured.');
  }
  return projectRepository;
}

async function initializeRepository(): Promise<ProjectRepositoryPort> {
  const repository = requireRepository();
  if (!initialization) {
    initialization = Promise.resolve(repository.initialize()).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
  return repository;
}

function newestFirst(projects: SnapCutProject[]): SnapCutProject[] {
  return [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function replaceProject(projects: SnapCutProject[], replacement: SnapCutProject): SnapCutProject[] {
  const withoutReplacement = projects.filter((project) => project.id !== replacement.id);
  return newestFirst([replacement, ...withoutReplacement]);
}

async function readRepairStatuses(
  repository: ProjectRepositoryPort,
  projects: readonly SnapCutProject[],
): Promise<Record<string, ProjectRepairStatus>> {
  const entries = await Promise.all(
    projects.map(async (project) => {
      const status = repository.getRepairStatus
        ? await repository.getRepairStatus(project.id)
        : null;
      return [project.id, status ?? { state: 'ready' as const, issues: [] }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function enqueueProjectWrite<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = projectWriteQueues.get(projectId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  projectWriteQueues.set(projectId, settled);
  void settled.finally(() => {
    if (projectWriteQueues.get(projectId) === settled) {
      projectWriteQueues.delete(projectId);
    }
  });
  return result;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  repairStatuses: {},
  corruptProjectIds: [],
  activeProject: null,
  loadingList: false,
  loadingProject: false,
  initialized: false,
  mutation: null,
  error: null,

  configureRepository: (repository) => {
    if (projectRepository === repository) return;
    projectRepository = repository;
    initialization = null;
    set({
      projects: [],
      repairStatuses: {},
      corruptProjectIds: [],
      activeProject: null,
      initialized: false,
      error: null,
    });
  },

  loadProjects: async () => {
    set({ loadingList: true, error: null });
    try {
      const repository = await initializeRepository();
      const projects = newestFirst(await repository.list());
      const [repairStatuses, corruptProjectIds] = await Promise.all([
        readRepairStatuses(repository, projects),
        repository.listCorruptProjectIds?.() ?? [],
      ]);
      set({ projects, repairStatuses, corruptProjectIds, initialized: true });
    } catch {
      set({ error: copy.projects.loadError });
    } finally {
      set({ loadingList: false });
    }
  },

  loadProject: async (projectId) => {
    const localProject = get().projects.find((project) => project.id === projectId) ?? null;
    set({ activeProject: localProject, loadingProject: !localProject, error: null });
    try {
      const repository = await initializeRepository();
      const project = await repository.get(projectId);
      const repairStatus = project
        ? ((await repository.getRepairStatus?.(projectId)) ?? {
            state: 'ready' as const,
            issues: [],
          })
        : null;
      set((state) => ({
        activeProject: project,
        projects: project ? replaceProject(state.projects, project) : state.projects,
        repairStatuses: project
          ? { ...state.repairStatuses, [project.id]: repairStatus! }
          : state.repairStatuses,
        initialized: true,
      }));
    } catch {
      set({ error: copy.projects.loadError });
    } finally {
      set({ loadingProject: false });
    }
  },

  createProject: async (name) => {
    set({ mutation: 'create', error: null });
    try {
      const repository = await initializeRepository();
      const project = await repository.create(name === undefined ? {} : { name });
      set((state) => ({
        projects: replaceProject(state.projects, project),
        repairStatuses: {
          ...state.repairStatuses,
          [project.id]: { state: 'ready', issues: [] },
        },
        activeProject: project,
      }));
      return project;
    } catch {
      set({ error: copy.projects.createError });
      return null;
    } finally {
      set({ mutation: null });
    }
  },

  renameProject: async (projectId, name) => {
    set({ mutation: 'rename', error: null });
    try {
      const repository = await initializeRepository();
      const project = await repository.rename(projectId, name);
      set((state) => ({
        projects: replaceProject(state.projects, project),
        activeProject: state.activeProject?.id === projectId ? project : state.activeProject,
      }));
      return true;
    } catch {
      set({ error: copy.projects.renameError });
      return false;
    } finally {
      set({ mutation: null });
    }
  },

  renameSource: async (projectId, sourceId, name) => {
    set({ mutation: 'rename-source', error: null });
    try {
      const repository = await initializeRepository();
      if (!repository.renameSource) throw new Error('Source rename is unavailable.');
      const project = await repository.renameSource(projectId, sourceId, name);
      set((state) => ({
        projects: replaceProject(state.projects, project),
        activeProject: state.activeProject?.id === projectId ? project : state.activeProject,
      }));
      return true;
    } catch {
      set({ error: 'The source could not be renamed.' });
      return false;
    } finally {
      set({ mutation: null });
    }
  },

  deleteSource: async (projectId, sourceId) => {
    set({ mutation: 'delete-source', error: null });
    try {
      const repository = await initializeRepository();
      if (!repository.deleteSource) throw new Error('Source deletion is unavailable.');
      const project = await repository.deleteSource(projectId, sourceId);
      const repairStatus = (await repository.getRepairStatus?.(projectId)) ?? {
        state: 'ready' as const,
        issues: [],
      };
      set((state) => ({
        projects: replaceProject(state.projects, project),
        activeProject: state.activeProject?.id === projectId ? project : state.activeProject,
        repairStatuses: {
          ...state.repairStatuses,
          [projectId]: repairStatus,
        },
      }));
      return true;
    } catch (caught: unknown) {
      const code =
        typeof caught === 'object' && caught !== null && 'code' in caught
          ? String(caught.code)
          : null;
      set({
        error:
          code === 'SOURCE_IN_USE'
            ? 'Remove clips that use this source first.'
            : 'The source could not be deleted.',
      });
      return false;
    } finally {
      set({ mutation: null });
    }
  },

  deleteProject: async (projectId) => {
    set({ mutation: 'delete', error: null });
    try {
      const repository = await initializeRepository();
      await projectReleasePort?.releaseProject(projectId);
      await repository.delete(projectId);
      set((state) => ({
        projects: state.projects.filter((project) => project.id !== projectId),
        repairStatuses: Object.fromEntries(
          Object.entries(state.repairStatuses).filter(([id]) => id !== projectId),
        ),
        activeProject: state.activeProject?.id === projectId ? null : state.activeProject,
      }));
      return true;
    } catch {
      set({ error: copy.projects.deleteError });
      return false;
    } finally {
      set({ mutation: null });
    }
  },

  deleteCorruptProject: async (projectId) => {
    set({ mutation: 'delete', error: null });
    try {
      const repository = await initializeRepository();
      if (!repository.deleteCorruptProject)
        throw new Error('Damaged project deletion unavailable.');
      await repository.deleteCorruptProject(projectId);
      set((state) => ({
        corruptProjectIds: state.corruptProjectIds.filter((id) => id !== projectId),
      }));
      return true;
    } catch {
      set({ error: copy.projects.deleteError });
      return false;
    } finally {
      set({ mutation: null });
    }
  },

  updateProject: async (projectId, update) => {
    activeProjectWrites += 1;
    set({ mutation: 'save', error: null });
    try {
      return await enqueueProjectWrite(projectId, async () => {
        const repository = await initializeRepository();
        const current = await repository.get(projectId);
        if (!current) throw new Error('Project is unavailable.');
        const saved = await repository.save(update(current));
        set((state) => ({
          projects: replaceProject(state.projects, saved),
          activeProject: state.activeProject?.id === projectId ? saved : state.activeProject,
        }));
        return saved;
      });
    } catch {
      set({ error: copy.editor.saveError });
      return null;
    } finally {
      activeProjectWrites -= 1;
      if (activeProjectWrites === 0) set({ mutation: null });
    }
  },

  clearActiveProject: () => set({ activeProject: null }),
  clearError: () => set({ error: null }),
  reset: () => {
    initialization = null;
    projectWriteQueues.clear();
    activeProjectWrites = 0;
    set({
      projects: [],
      repairStatuses: {},
      corruptProjectIds: [],
      activeProject: null,
      loadingList: false,
      loadingProject: false,
      initialized: false,
      mutation: null,
      error: null,
    });
  },
}));

export function configureProjectRepository(repository: ProjectRepositoryPort): void {
  useProjectStore.getState().configureRepository(repository);
}

export function configureProjectReleasePort(port: ProjectReleasePort | null): void {
  projectReleasePort = port;
}
