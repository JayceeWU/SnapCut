import { randomUUID } from 'expo-crypto';

import {
  addSource,
  buildProjectIndex,
  createProject,
  removeUnusedSource,
  renameProject,
  renameSource as renameProjectSource,
} from '@/domain/projects';
import { diagnosticLog } from '@/diagnostics';
import {
  projectIndexSchema,
  snapCutProjectSchema,
  sourceFileSchema,
  waveformFileSchema,
} from '@/domain/schemas';
import type { SnapCutProject, SourceFile, WaveformFile, WaveformStatus } from '@/domain/types';
import { immutableSourceMetadata } from '@/domain/sourceRelations';
import { nativePrivateMediaVerifier } from '@/services/NativePrivateMediaVerifier';
import {
  RecoveryService,
  type ProjectRepairStatus,
  type RecoveryDiagnostic,
} from '@/services/RecoveryService';
import { AtomicJsonStore } from './AtomicJsonStore';
import {
  importTransactionJournalSchema,
  type BeginImportInput,
  type FinalizeImportInput,
  type ImportTransactionJournal,
  type ImportTransactionPaths,
  type PrivateMediaVerification,
  type PrivateMediaVerifier,
  SHA256_PATTERN,
} from './ImportTransaction';
import { KeyedWriteQueue } from './KeyedWriteQueue';
import {
  sourceDeletionJournalSchema,
  type SourceDeletionLifecyclePort,
  type SourceDeletionJournal,
} from './SourceDeletionTransaction';
import { StorageGenerationService } from './StorageGenerationService';
import { StorageLayout, storageLayout } from './StorageLayout';

export type ProjectRepositoryErrorCode =
  | 'REPOSITORY_NOT_INITIALIZED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_ALREADY_EXISTS'
  | 'IMPORT_ALREADY_EXISTS'
  | 'IMPORT_FILE_MISSING'
  | 'IMPORT_RESULT_INVALID'
  | 'PROJECT_DELETE_FAILED'
  | 'SOURCE_IN_USE'
  | 'SOURCE_DELETE_FAILED';

export class ProjectRepositoryError extends Error {
  constructor(
    readonly code: ProjectRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectRepositoryError';
  }
}

export interface CreateProjectOptions {
  readonly id?: string;
  readonly name?: string | null;
}

export interface ProjectRepositoryOptions {
  readonly layout?: StorageLayout;
  readonly recoveryService?: RecoveryService;
  readonly privateMediaVerifier?: PrivateMediaVerifier;
  readonly onRecoveryDiagnostic?: (diagnostic: RecoveryDiagnostic) => void;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly storageGenerationService?: Pick<StorageGenerationService, 'ensureCurrentGeneration'>;
  readonly sourceDeletionLifecycle?: SourceDeletionLifecyclePort;
}

function cloneProject(project: SnapCutProject): SnapCutProject {
  return JSON.parse(JSON.stringify(project)) as SnapCutProject;
}

function sortProjects(projects: readonly SnapCutProject[]): SnapCutProject[] {
  return [...projects].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
  );
}

export class ProjectRepository {
  private readonly layout: StorageLayout;
  private readonly recovery: RecoveryService;
  private readonly json: AtomicJsonStore;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly privateMediaVerifier: PrivateMediaVerifier | undefined;
  private readonly storageGeneration: Pick<StorageGenerationService, 'ensureCurrentGeneration'>;
  private sourceDeletionLifecycle: SourceDeletionLifecyclePort | undefined;
  private readonly writeQueue = new KeyedWriteQueue();
  private projects: SnapCutProject[] = [];
  private readonly repairStatuses = new Map<string, ProjectRepairStatus>();
  private corruptProjectIds: string[] = [];
  private initialized = false;
  private initialization: Promise<void> | null = null;

  constructor(options: ProjectRepositoryOptions = {}) {
    this.layout = options.layout ?? storageLayout;
    this.privateMediaVerifier = options.privateMediaVerifier;
    this.recovery =
      options.recoveryService ??
      new RecoveryService(this.layout, {
        ...(this.privateMediaVerifier === undefined
          ? {}
          : { privateMediaVerifier: this.privateMediaVerifier }),
        ...(options.onRecoveryDiagnostic === undefined
          ? {}
          : { onDiagnostic: options.onRecoveryDiagnostic }),
      });
    this.json = new AtomicJsonStore(this.layout.fileSystem);
    this.storageGeneration =
      options.storageGenerationService ?? new StorageGenerationService(this.layout);
    this.sourceDeletionLifecycle = options.sourceDeletionLifecycle;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialization ??= this.initializeInternal();
    try {
      await this.initialization;
    } finally {
      if (!this.initialized) {
        this.initialization = null;
      }
    }
  }

  configureSourceDeletionLifecycle(lifecycle: SourceDeletionLifecyclePort | undefined): void {
    this.sourceDeletionLifecycle = lifecycle;
  }

  list(): SnapCutProject[] {
    this.assertInitialized();
    return this.projects.map(cloneProject);
  }

  get(projectId: string): SnapCutProject | null {
    this.assertInitialized();
    const project = this.projects.find((candidate) => candidate.id === projectId);
    return project === undefined ? null : cloneProject(project);
  }

  getRepairStatus(projectId: string): ProjectRepairStatus | null {
    this.assertInitialized();
    const status = this.repairStatuses.get(projectId);
    return status === undefined ? null : { state: status.state, issues: [...status.issues] };
  }

  listCorruptProjectIds(): string[] {
    this.assertInitialized();
    return [...this.corruptProjectIds];
  }

  resolveSourceAudioUri(projectId: string, sourceId: string): string {
    this.assertInitialized();
    const source = this.requireSource(projectId, sourceId);
    return this.layout.sourceAudioUri(projectId, sourceId, source.privateAudioFileName);
  }

  resolveSourceWaveformUri(projectId: string, sourceId: string): string {
    this.assertInitialized();
    const source = this.requireSource(projectId, sourceId);
    if (source.waveformFileName !== 'waveform.json') {
      throw new ProjectRepositoryError(
        'IMPORT_RESULT_INVALID',
        'The source waveform file name is invalid.',
      );
    }
    return this.layout.sourceWaveformUri(projectId, sourceId);
  }

  async loadWaveform(projectId: string, sourceId: string): Promise<WaveformFile | null> {
    this.assertInitialized();
    const source = this.requireSource(projectId, sourceId);
    if (source.waveformStatus !== 'ready') return null;
    const waveform = await this.json.read(
      this.layout.sourceWaveformUri(projectId, sourceId),
      (raw) => waveformFileSchema.parse(raw),
    );
    return waveform !== null && waveform.durationMs === source.durationMs ? waveform : null;
  }

  updateSourceWaveformStatus(
    projectId: string,
    sourceId: string,
    waveformStatus: WaveformStatus,
  ): Promise<SnapCutProject> {
    this.assertInitialized();
    return this.writeQueue.run(projectId, async () => {
      const current = this.requireProject(projectId);
      const sourceIndex = current.sources.findIndex(({ id }) => id === sourceId);
      if (sourceIndex < 0) {
        throw new ProjectRepositoryError('PROJECT_NOT_FOUND', `Source ${sourceId} was not found.`);
      }
      if (waveformStatus === 'ready') {
        const source = current.sources[sourceIndex];
        if (source === undefined) {
          throw new ProjectRepositoryError(
            'PROJECT_NOT_FOUND',
            `Source ${sourceId} was not found.`,
          );
        }
        const waveform = await this.json.read(
          this.layout.sourceWaveformUri(projectId, sourceId),
          (raw) => waveformFileSchema.parse(raw),
        );
        if (waveform === null || waveform.durationMs !== source.durationMs) {
          throw new ProjectRepositoryError(
            'IMPORT_RESULT_INVALID',
            'The generated waveform did not pass validation.',
          );
        }
      }
      const sources = current.sources.map((source) =>
        source.id === sourceId ? { ...source, waveformStatus } : source,
      );
      const updated = snapCutProjectSchema.parse({
        ...current,
        sources,
        updatedAt: this.now(),
      });
      await this.writeProject(updated);
      const status = await this.recovery.inspectProject(updated);
      this.replaceInMemory(updated, status);
      await this.writeIndex();
      return cloneProject(updated);
    });
  }

  async create(options: CreateProjectOptions = {}): Promise<SnapCutProject> {
    this.assertInitialized();
    const createInput = {
      id: options.id ?? this.idFactory(),
      now: this.now(),
      ...(options.name === undefined ? {} : { name: options.name }),
    };
    const project = createProject(createInput);
    return this.writeQueue.run(project.id, async () => {
      if (this.layout.fileSystem.directoryExists(this.layout.projectDirectoryUri(project.id))) {
        throw new ProjectRepositoryError(
          'PROJECT_ALREADY_EXISTS',
          `Project ${project.id} already exists.`,
        );
      }
      this.layout.fileSystem.ensureDirectory(this.layout.projectDirectoryUri(project.id));
      this.layout.fileSystem.ensureDirectory(this.layout.projectSourcesDirectoryUri(project.id));
      try {
        await this.writeProject(project);
      } catch (error) {
        this.tryRemoveProjectDirectory(project.id);
        throw error;
      }
      this.replaceInMemory(project, { state: 'ready', issues: [] });
      await this.writeIndex();
      return cloneProject(project);
    });
  }

  save(projectInput: SnapCutProject): Promise<SnapCutProject> {
    this.assertInitialized();
    const project = projectInput;
    return this.writeQueue.run(project.id, async () => {
      this.requireProject(project.id);
      const current = this.requireProject(project.id);
      if (JSON.stringify(project.sources) !== JSON.stringify(current.sources)) {
        throw new ProjectRepositoryError(
          'IMPORT_RESULT_INVALID',
          'Source changes require the dedicated import, rename, waveform, or delete operation.',
        );
      }
      const withTimestamp = snapCutProjectSchema.parse({
        ...project,
        createdAt: current.createdAt,
        updatedAt: this.now(),
      });
      await this.writeProject(withTimestamp);
      const status = await this.recovery.inspectProject(withTimestamp);
      this.replaceInMemory(withTimestamp, status);
      await this.writeIndex();
      return cloneProject(withTimestamp);
    });
  }

  rename(projectId: string, name: string): Promise<SnapCutProject> {
    this.assertInitialized();
    return this.writeQueue.run(projectId, async () => {
      const current = this.requireProject(projectId);
      const renamed = renameProject(current, name, this.now());
      await this.writeProject(renamed);
      const status = this.repairStatuses.get(projectId) ?? { state: 'ready' as const, issues: [] };
      this.replaceInMemory(renamed, status);
      await this.writeIndex();
      return cloneProject(renamed);
    });
  }

  renameSource(projectId: string, sourceId: string, displayName: string): Promise<SnapCutProject> {
    this.assertInitialized();
    return this.writeQueue.run(projectId, async () => {
      const renamed = renameProjectSource(
        this.requireProject(projectId),
        sourceId,
        displayName,
        this.now(),
      );
      await this.writeProject(renamed);
      const status = this.repairStatuses.get(projectId) ?? { state: 'ready' as const, issues: [] };
      this.replaceInMemory(renamed, status);
      await this.writeIndex();
      return cloneProject(renamed);
    });
  }

  async deleteSource(projectId: string, sourceId: string): Promise<SnapCutProject> {
    this.assertInitialized();
    const beforePrepare = this.requireProject(projectId);
    if (!beforePrepare.sources.some(({ id }) => id === sourceId)) {
      throw new ProjectRepositoryError('PROJECT_NOT_FOUND', `Source ${sourceId} was not found.`);
    }
    if (beforePrepare.clips.some((clip) => clip.sourceId === sourceId)) {
      throw new ProjectRepositoryError(
        'SOURCE_IN_USE',
        'Remove clips that use this source before deleting it.',
      );
    }
    // Do not hold the project queue here: cancelling a waveform may finish by
    // persisting its terminal status through this same queue.
    await this.sourceDeletionLifecycle?.prepare(projectId, sourceId);

    return this.writeQueue.run(projectId, async () => {
      const current = this.requireProject(projectId);
      if (!current.sources.some(({ id }) => id === sourceId)) {
        throw new ProjectRepositoryError('PROJECT_NOT_FOUND', `Source ${sourceId} was not found.`);
      }
      if (current.clips.some((clip) => clip.sourceId === sourceId)) {
        throw new ProjectRepositoryError(
          'SOURCE_IN_USE',
          'Remove clips that use this source before deleting it.',
        );
      }
      const updated = removeUnusedSource(current, sourceId, this.now());
      const jobId = this.idFactory();
      const sourceDirectory = this.layout.sourceDirectoryUri(projectId, sourceId);
      const deletionDirectory = this.layout.sourceDeleteDirectoryUri(jobId);
      const journalUri = this.layout.projectSourceDeleteJournalUri(projectId, jobId);
      if (
        !this.layout.fileSystem.directoryExists(sourceDirectory) ||
        this.layout.fileSystem.directoryExists(deletionDirectory)
      ) {
        throw new ProjectRepositoryError(
          'SOURCE_DELETE_FAILED',
          'The app-private source directory is unavailable for deletion.',
        );
      }

      const journal: SourceDeletionJournal = {
        schemaVersion: 1,
        jobId,
        projectId,
        sourceId,
        projectUpdatedAt: updated.updatedAt,
      };
      await this.json.write(journalUri, journal, (raw) => sourceDeletionJournalSchema.parse(raw));

      let movedToDeletionDirectory = false;
      let projectCommitted = false;
      try {
        try {
          await this.layout.fileSystem.moveDirectory(sourceDirectory, deletionDirectory);
        } catch {
          // Some providers report failure after a completed move; state below is authoritative.
        }
        movedToDeletionDirectory =
          this.layout.fileSystem.directoryExists(deletionDirectory) &&
          !this.layout.fileSystem.directoryExists(sourceDirectory);
        if (!movedToDeletionDirectory) {
          throw new ProjectRepositoryError(
            'SOURCE_DELETE_FAILED',
            'The app-private source could not enter the deletion transaction.',
          );
        }
        try {
          await this.writeProject(updated);
          projectCommitted = true;
        } catch (error) {
          const official = await this.readOfficialProject(projectId);
          if (official !== null && this.projectsMatch(official, updated)) {
            projectCommitted = true;
          } else {
            throw error;
          }
        }
      } catch (error) {
        if (!projectCommitted && movedToDeletionDirectory) {
          try {
            await this.layout.fileSystem.moveDirectory(deletionDirectory, sourceDirectory);
          } catch {
            // Keep the journal so startup recovery can finish the rollback.
          }
        }
        if (this.layout.fileSystem.directoryExists(sourceDirectory)) {
          this.tryDeleteFile(journalUri);
        }
        throw error;
      }

      try {
        this.layout.fileSystem.deleteDirectory(deletionDirectory);
        if (!this.layout.fileSystem.directoryExists(deletionDirectory)) {
          this.tryDeleteFile(journalUri);
        }
      } catch {
        // The source is no longer visible. Recovery retries app-private cleanup.
      }
      // Compute repair state only after the direct cleanup attempt. Inspection
      // is also the bounded retry for a provider that failed once, ensuring the
      // cached state reflects the final on-disk journal/staging state.
      const status = await this.recovery.inspectProject(updated);
      this.replaceInMemory(updated, status);
      await this.writeIndex();
      return cloneProject(updated);
    });
  }

  async delete(projectId: string): Promise<void> {
    this.assertInitialized();
    await this.writeQueue.run(projectId, async () => {
      this.requireProject(projectId);
      const uri = this.layout.projectDirectoryUri(projectId);
      if (!this.layout.isInsideProjects(uri)) {
        throw new ProjectRepositoryError(
          'PROJECT_DELETE_FAILED',
          'Unsafe project deletion target.',
        );
      }
      await this.cleanupPendingSourceDeletions(projectId);
      this.layout.fileSystem.deleteDirectory(uri);
      if (this.layout.fileSystem.directoryExists(uri)) {
        throw new ProjectRepositoryError('PROJECT_DELETE_FAILED', 'Project directory remains.');
      }
      this.projects = this.projects.filter((project) => project.id !== projectId);
      this.repairStatuses.delete(projectId);
      this.corruptProjectIds = this.corruptProjectIds.filter((id) => id !== projectId);
      await this.writeIndex();
    });
  }

  async deleteCorruptProject(projectId: string): Promise<void> {
    this.assertInitialized();
    await this.writeQueue.run(projectId, async () => {
      if (!this.corruptProjectIds.includes(projectId)) {
        throw new ProjectRepositoryError('PROJECT_NOT_FOUND', 'Damaged project was not found.');
      }
      const uri = this.layout.projectDirectoryUri(projectId);
      if (!this.layout.isInsideProjects(uri)) {
        throw new ProjectRepositoryError(
          'PROJECT_DELETE_FAILED',
          'Unsafe damaged project deletion target.',
        );
      }
      await this.cleanupPendingSourceDeletions(projectId);
      this.layout.fileSystem.deleteDirectory(uri);
      if (this.layout.fileSystem.directoryExists(uri)) {
        throw new ProjectRepositoryError(
          'PROJECT_DELETE_FAILED',
          'Damaged project directory remains.',
        );
      }
      this.corruptProjectIds = this.corruptProjectIds.filter((id) => id !== projectId);
      await this.writeIndex();
    });
  }

  beginImport(input: BeginImportInput): ImportTransactionPaths {
    this.assertInitialized();
    this.requireProject(input.projectId);
    if (
      this.requireProject(input.projectId).sources.some(({ id }) => id === input.sourceId) ||
      this.layout.fileSystem.directoryExists(
        this.layout.sourceDirectoryUri(input.projectId, input.sourceId),
      )
    ) {
      throw new ProjectRepositoryError('IMPORT_ALREADY_EXISTS', 'The source already exists.');
    }
    const stagingDirectoryUri = this.layout.transactionDirectoryUri(input.jobId);
    if (this.layout.fileSystem.directoryExists(stagingDirectoryUri)) {
      throw new ProjectRepositoryError(
        'IMPORT_ALREADY_EXISTS',
        `Import job ${input.jobId} already exists.`,
      );
    }
    this.layout.fileSystem.ensureDirectory(
      this.layout.transactionSourceDirectoryUri(input.jobId, input.sourceId),
    );
    return {
      jobId: input.jobId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      stagingDirectoryUri,
      outputFileUri: this.layout.transactionAudioUri(
        input.jobId,
        input.sourceId,
        input.privateAudioFileName,
      ),
      privateAudioRelativePath: `sources/${input.sourceId}/${input.privateAudioFileName}`,
    };
  }

  finalizeImport(input: FinalizeImportInput): Promise<SnapCutProject> {
    this.assertInitialized();
    return this.writeQueue.run(input.projectId, async () => {
      const current = this.requireProject(input.projectId);
      const source = input.source;
      if (
        source.id.length === 0 ||
        !SHA256_PATTERN.test(input.privateAudioSha256) ||
        source.privateAudioSha256 !== input.privateAudioSha256
      ) {
        throw new ProjectRepositoryError('IMPORT_RESULT_INVALID', 'Import metadata is invalid.');
      }
      const partialUri = this.layout.transactionAudioUri(
        input.jobId,
        source.id,
        source.privateAudioFileName,
      );
      if (
        !this.layout.fileSystem.fileExists(partialUri) ||
        this.layout.fileSystem.fileSize(partialUri) !== source.fileSizeBytes
      ) {
        throw new ProjectRepositoryError(
          'IMPORT_FILE_MISSING',
          'The inspected private import is missing or has changed size.',
        );
      }
      const completedAudioUri = partialUri.slice(0, -'.partial'.length);
      await this.layout.fileSystem.moveFile(partialUri, completedAudioUri);

      const sourceFile: SourceFile = {
        schemaVersion: 2,
        projectId: current.id,
        source: immutableSourceMetadata(source),
      };
      await this.json.write(
        this.layout.transactionSourceMetadataUri(input.jobId, source.id),
        sourceFile,
        (raw) => sourceFileSchema.parse(raw),
      );
      const stagedWaveformUri = this.layout.transactionWaveformUri(input.jobId, source.id);
      if (this.layout.fileSystem.fileExists(stagedWaveformUri)) {
        const waveform = await this.json.read(stagedWaveformUri, (raw) =>
          waveformFileSchema.parse(raw),
        );
        if (waveform === null || waveform.durationMs !== source.durationMs) {
          throw new ProjectRepositoryError(
            'IMPORT_RESULT_INVALID',
            'The staged waveform is invalid.',
          );
        }
      } else if (source.waveformStatus === 'ready') {
        throw new ProjectRepositoryError('IMPORT_FILE_MISSING', 'The ready waveform is missing.');
      }

      const updatedAt = this.now();
      const updated = addSource(current, source, updatedAt);
      const journal: ImportTransactionJournal = {
        schemaVersion: 1,
        jobId: input.jobId,
        projectId: input.projectId,
        sourceId: source.id,
        privateAudioFileName: source.privateAudioFileName,
        expectedFileSizeBytes: source.fileSizeBytes,
        expectedSha256: input.privateAudioSha256,
        projectUpdatedAt: updated.updatedAt,
        nativeInspectionComplete: true,
      };

      const journalUri = this.layout.projectTransactionJournalUri(input.projectId, input.jobId);
      const finalSourceDirectory = this.layout.sourceDirectoryUri(input.projectId, source.id);
      const finalAudioUri = this.layout.sourceAudioUri(
        input.projectId,
        source.id,
        source.privateAudioFileName,
      );
      let committedProject: SnapCutProject | null = null;
      let ownsFinalSourceDirectory = false;
      try {
        await this.json.write(journalUri, journal, (raw) =>
          importTransactionJournalSchema.parse(raw),
        );
        if (this.layout.fileSystem.directoryExists(finalSourceDirectory)) {
          throw new ProjectRepositoryError('IMPORT_ALREADY_EXISTS', 'The source already exists.');
        }
        this.layout.fileSystem.ensureDirectory(
          this.layout.projectSourcesDirectoryUri(input.projectId),
        );
        try {
          await this.layout.fileSystem.moveDirectory(
            this.layout.transactionSourceDirectoryUri(input.jobId, source.id),
            finalSourceDirectory,
          );
        } catch {
          // A provider can complete a move and then report an error. The actual
          // source/destination state and native verification below are authoritative.
        }
        ownsFinalSourceDirectory = this.layout.fileSystem.directoryExists(finalSourceDirectory);
        if (
          this.layout.fileSystem.directoryExists(
            this.layout.transactionSourceDirectoryUri(input.jobId, source.id),
          ) ||
          !this.layout.fileSystem.fileExists(finalAudioUri)
        ) {
          throw new ProjectRepositoryError(
            'IMPORT_RESULT_INVALID',
            'Final source move did not complete.',
          );
        }
        await this.requireVerifiedPrivateMedia(
          finalAudioUri,
          source.fileSizeBytes,
          input.privateAudioSha256,
        );

        // project.json is the only visibility commit point.
        await this.writeProject(updated);
        committedProject = updated;
      } catch (error) {
        // Atomic JSON providers can report an error after the destination is
        // already committed. The validated official project is authoritative.
        const official = await this.readOfficialProject(input.projectId);
        if (official !== null && this.projectsMatch(official, updated)) {
          committedProject = official;
        } else {
          this.rollbackUncommittedImport(
            input.jobId,
            ownsFinalSourceDirectory ? finalSourceDirectory : null,
            journalUri,
          );
          throw error;
        }
      }

      this.tryDeleteFile(journalUri);
      this.tryRemoveTransactionDirectory(input.jobId);
      const visibleProject = committedProject ?? updated;
      const status = await this.recovery.inspectProject(visibleProject);
      this.replaceInMemory(visibleProject, status);
      await this.writeIndex();
      return cloneProject(visibleProject);
    });
  }

  cancelImport(jobId: string): void {
    const uri = this.layout.transactionDirectoryUri(jobId);
    if (this.layout.fileSystem.directoryExists(uri)) {
      this.layout.fileSystem.deleteDirectory(uri);
    }
  }

  private async initializeInternal(): Promise<void> {
    await this.storageGeneration.ensureCurrentGeneration();
    const report = await this.recovery.recover();
    this.projects = report.projects.map(({ project }) => project);
    this.corruptProjectIds = [...report.corruptProjectIds];
    this.repairStatuses.clear();
    report.projects.forEach(({ project, repairStatus }) =>
      this.repairStatuses.set(project.id, repairStatus),
    );
    this.initialized = true;
  }

  private async writeProject(project: SnapCutProject): Promise<void> {
    await this.json.write(this.layout.projectMetadataUri(project.id), project, (raw) =>
      snapCutProjectSchema.parse(raw),
    );
  }

  private async requireVerifiedPrivateMedia(
    fileUri: string,
    expectedFileSizeBytes: number,
    expectedSha256: string,
  ): Promise<void> {
    if (this.privateMediaVerifier === undefined) {
      throw new ProjectRepositoryError(
        'IMPORT_RESULT_INVALID',
        'Native private-media verification is unavailable.',
      );
    }
    let verification: PrivateMediaVerification;
    try {
      verification = await this.privateMediaVerifier.verifyPrivateMedia(fileUri);
    } catch (error) {
      throw new ProjectRepositoryError(
        'IMPORT_RESULT_INVALID',
        'Native final private-media verification failed.',
        { cause: error },
      );
    }
    if (
      !Number.isSafeInteger(verification.fileSizeBytes) ||
      verification.fileSizeBytes <= 0 ||
      !SHA256_PATTERN.test(verification.sha256) ||
      verification.fileSizeBytes !== expectedFileSizeBytes ||
      verification.sha256 !== expectedSha256
    ) {
      throw new ProjectRepositoryError(
        'IMPORT_RESULT_INVALID',
        'Final private media does not match the native import result.',
      );
    }
  }

  private async readOfficialProject(projectId: string): Promise<SnapCutProject | null> {
    return this.json.read(this.layout.projectMetadataUri(projectId), (raw) =>
      snapCutProjectSchema.parse(raw),
    );
  }

  private projectsMatch(left: SnapCutProject, right: SnapCutProject): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private rollbackUncommittedImport(
    jobId: string,
    finalSourceDirectory: string | null,
    journalUri: string,
  ): void {
    try {
      if (
        finalSourceDirectory !== null &&
        this.layout.fileSystem.directoryExists(finalSourceDirectory)
      ) {
        this.layout.fileSystem.deleteDirectory(finalSourceDirectory);
      }
    } catch {
      // Keep the journal as recovery proof if the orphan source cannot be removed.
      return;
    }
    if (
      finalSourceDirectory !== null &&
      this.layout.fileSystem.directoryExists(finalSourceDirectory)
    ) {
      return;
    }
    this.tryDeleteFile(journalUri);
    this.tryDeleteFile(`${journalUri}.tmp`);
    this.tryDeleteFile(`${journalUri}.bak`);
    this.tryRemoveTransactionDirectory(jobId);
  }

  private async writeIndex(): Promise<void> {
    try {
      await this.json.write(
        this.layout.indexUri,
        buildProjectIndex(this.projects),
        (raw) => projectIndexSchema.parse(raw),
        { preserveInvalidCommitted: true },
      );
    } catch {
      // index.json is a rebuildable cache. A cache refresh must never turn an
      // already-committed project mutation into a reported failure.
    }
  }

  /**
   * A project directory owns the only trusted link between a source-delete
   * job and its staging trash. Validate every committed journal first, then
   * remove only the exact derived staging directories. This runs before both
   * healthy and corrupt project deletion so deleting the journals cannot
   * strand private media forever.
   */
  private async cleanupPendingSourceDeletions(projectId: string): Promise<void> {
    const projectDirectory = this.layout.projectDirectoryUri(projectId);
    const pending: string[] = [];
    for (const entry of this.layout.fileSystem.listDirectory(projectDirectory)) {
      const fileJobId = this.layout.sourceDeleteJobIdFromJournalFileName(entry.name);
      if (fileJobId === null) continue;
      if (entry.kind !== 'file') {
        throw new ProjectRepositoryError(
          'PROJECT_DELETE_FAILED',
          'A source deletion journal is not a regular app-private file.',
        );
      }
      const journal = await this.json.read(entry.uri, (raw) =>
        sourceDeletionJournalSchema.parse(raw),
      );
      if (
        journal === null ||
        journal.projectId !== projectId ||
        journal.jobId !== fileJobId ||
        entry.uri !== this.layout.projectSourceDeleteJournalUri(projectId, journal.jobId)
      ) {
        throw new ProjectRepositoryError(
          'PROJECT_DELETE_FAILED',
          'A source deletion journal failed strict containment validation.',
        );
      }
      const deletionDirectoryUri = this.layout.sourceDeleteDirectoryUri(journal.jobId);
      if (!this.layout.isSourceDeleteDirectoryUri(deletionDirectoryUri)) {
        throw new ProjectRepositoryError(
          'PROJECT_DELETE_FAILED',
          'A source deletion target is outside the strict staging layout.',
        );
      }
      pending.push(deletionDirectoryUri);
    }

    for (const deletionDirectoryUri of pending) {
      try {
        if (this.layout.fileSystem.directoryExists(deletionDirectoryUri)) {
          this.layout.fileSystem.deleteDirectory(deletionDirectoryUri);
        }
      } catch (error) {
        throw new ProjectRepositoryError(
          'PROJECT_DELETE_FAILED',
          'Pending source deletion media could not be removed safely.',
          { cause: error },
        );
      }
      if (this.layout.fileSystem.directoryExists(deletionDirectoryUri)) {
        throw new ProjectRepositoryError(
          'PROJECT_DELETE_FAILED',
          'Pending source deletion media remains in app-private staging.',
        );
      }
    }
  }

  private replaceInMemory(project: SnapCutProject, status: ProjectRepairStatus): void {
    this.projects = sortProjects([
      project,
      ...this.projects.filter((candidate) => candidate.id !== project.id),
    ]);
    this.repairStatuses.set(project.id, status);
  }

  private requireProject(projectId: string): SnapCutProject {
    const project = this.projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) {
      throw new ProjectRepositoryError('PROJECT_NOT_FOUND', `Project ${projectId} was not found.`);
    }
    return project;
  }

  private requireSource(projectId: string, sourceId: string): SnapCutProject['sources'][number] {
    const source = this.requireProject(projectId).sources.find(({ id }) => id === sourceId);
    if (source === undefined) {
      throw new ProjectRepositoryError('PROJECT_NOT_FOUND', `Source ${sourceId} was not found.`);
    }
    return source;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new ProjectRepositoryError(
        'REPOSITORY_NOT_INITIALIZED',
        'ProjectRepository.initialize() must finish before access.',
      );
    }
  }

  private tryDeleteFile(uri: string): void {
    try {
      this.layout.fileSystem.deleteFile(uri);
    } catch {
      // A committed project remains valid; later recovery can remove the journal.
    }
  }

  private tryRemoveTransactionDirectory(jobId: string): void {
    const uri = this.layout.transactionDirectoryUri(jobId);
    try {
      if (this.layout.fileSystem.directoryExists(uri)) {
        this.layout.fileSystem.deleteDirectory(uri);
      }
    } catch {
      // App-owned staging is pruned after the recovery grace period.
    }
  }

  private tryRemoveProjectDirectory(projectId: string): void {
    const uri = this.layout.projectDirectoryUri(projectId);
    try {
      if (this.layout.fileSystem.directoryExists(uri)) {
        this.layout.fileSystem.deleteDirectory(uri);
      }
    } catch {
      // Preserve the failed directory for recovery/repair instead of hiding data loss.
    }
  }
}

export const projectRepository = new ProjectRepository({
  privateMediaVerifier: nativePrivateMediaVerifier,
  onRecoveryDiagnostic: (diagnostic) => {
    const projectId = 'projectId' in diagnostic ? diagnostic.projectId : undefined;
    const jobId = 'jobId' in diagnostic ? diagnostic.jobId : undefined;
    const repairIssues =
      diagnostic.code === 'PROJECT_NEEDS_REPAIR'
        ? diagnostic.issues.join(',').slice(0, 80)
        : undefined;
    void diagnosticLog.append(
      diagnostic.code === 'INDEX_REBUILT' ? 'info' : 'warn',
      'repository.recovery',
      {
        operation: 'repository',
        code: diagnostic.code,
        ...(projectId === undefined ? {} : { projectId }),
        ...(jobId === undefined ? {} : { jobId }),
        ...(repairIssues === undefined ? {} : { repairIssues }),
      },
    );
  },
});
