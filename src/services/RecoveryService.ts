import {
  projectIndexSchema,
  snapCutProjectSchema,
  sourceFileSchema,
  waveformFileSchema,
} from '@/domain/schemas';
import { sourceMetadataMatchesProjectSource } from '@/domain/sourceRelations';
import { compositionDurationMs } from '@/domain/timeline';
import type { SnapCutProject } from '@/domain/types';
import { AtomicJsonStore } from '@/repositories/AtomicJsonStore';
import {
  importTransactionJournalSchema,
  SHA256_PATTERN,
  type ImportTransactionJournal,
  type PrivateMediaVerification,
  type PrivateMediaVerifier,
} from '@/repositories/ImportTransaction';
import {
  INDEX_FILE_NAME,
  PROJECT_FILE_NAME,
  SOURCE_DELETE_DIRECTORY_PREFIX,
  SOURCE_DELETE_JOURNAL_SUFFIX,
  SOURCE_METADATA_FILE_NAME,
  TRANSACTION_DIRECTORY_PREFIX,
  TRANSACTION_JOURNAL_SUFFIX,
  WAVEFORM_FILE_NAME,
  StorageLayout,
  storageLayout,
} from '@/repositories/StorageLayout';
import type { StorageEntry } from '@/repositories/StorageFileSystem';
import { sourceDeletionJournalSchema } from '@/repositories/SourceDeletionTransaction';

export const STALE_TRANSACTION_AGE_MS = 24 * 60 * 60 * 1000;

export type ProjectRepairIssue =
  | 'PROJECT_METADATA_CORRUPT'
  | 'SOURCE_DIRECTORY_MISSING'
  | 'SOURCE_METADATA_INVALID'
  | 'SOURCE_RELATION_MISMATCH'
  | 'PRIVATE_MEDIA_MISSING_OR_EMPTY'
  | 'PRIVATE_MEDIA_SIZE_MISMATCH'
  | 'PRIVATE_MEDIA_HASH_UNVERIFIED'
  | 'WAVEFORM_MISSING'
  | 'WAVEFORM_INVALID'
  | 'WAVEFORM_DURATION_MISMATCH'
  | 'INCOMPLETE_IMPORT_TRANSACTION'
  | 'INCOMPLETE_SOURCE_DELETE_TRANSACTION';

export interface ProjectRepairStatus {
  readonly state: 'ready' | 'needs-repair';
  readonly issues: readonly ProjectRepairIssue[];
}

export type RecoveryDiagnostic =
  | { readonly code: 'JSON_BACKUP_RESTORED'; readonly uri: string }
  | { readonly code: 'JSON_TEMP_COMMITTED'; readonly uri: string }
  | { readonly code: 'INDEX_REBUILT'; readonly projectCount: number }
  | { readonly code: 'STALE_TRANSACTION_REMOVED'; readonly jobId: string }
  | {
      readonly code: 'PROJECT_NEEDS_REPAIR';
      readonly projectId: string;
      readonly issues: readonly ProjectRepairIssue[];
    };

export interface RecoveredProject {
  readonly project: SnapCutProject;
  readonly repairStatus: ProjectRepairStatus;
}

export interface RecoveryReport {
  readonly projects: readonly RecoveredProject[];
  readonly corruptProjectIds: readonly string[];
  readonly removedTransactionIds: readonly string[];
  readonly diagnostics: readonly RecoveryDiagnostic[];
}

export interface RecoveryServiceOptions {
  readonly now?: () => number;
  readonly activeJobIds?: () => ReadonlySet<string>;
  readonly onDiagnostic?: (diagnostic: RecoveryDiagnostic) => void;
  readonly privateMediaVerifier?: PrivateMediaVerifier;
}

function readyStatus(): ProjectRepairStatus {
  return { state: 'ready', issues: [] };
}

function repairStatus(issues: readonly ProjectRepairIssue[]): ProjectRepairStatus {
  return issues.length === 0 ? readyStatus() : { state: 'needs-repair', issues };
}

export class RecoveryService {
  private readonly json: AtomicJsonStore;
  private readonly now: () => number;
  private readonly activeJobIds: () => ReadonlySet<string>;
  private readonly onDiagnostic: ((diagnostic: RecoveryDiagnostic) => void) | undefined;
  private readonly privateMediaVerifier: PrivateMediaVerifier | undefined;

  constructor(
    private readonly layout: StorageLayout = storageLayout,
    options: RecoveryServiceOptions = {},
  ) {
    this.json = new AtomicJsonStore(layout.fileSystem);
    this.now = options.now ?? Date.now;
    this.activeJobIds = options.activeJobIds ?? (() => new Set<string>());
    this.onDiagnostic = options.onDiagnostic;
    this.privateMediaVerifier = options.privateMediaVerifier;
  }

  async recover(): Promise<RecoveryReport> {
    this.layout.ensureBaseDirectories();
    const diagnostics: RecoveryDiagnostic[] = [];
    const corruptProjectIds: string[] = [];
    const projects: RecoveredProject[] = [];

    for (const entry of this.safeList(this.layout.projectsDirectoryUri)) {
      if (entry.kind !== 'directory') {
        continue;
      }
      const project = await this.recoverProjectMetadata(entry, diagnostics);
      if (project === null) {
        corruptProjectIds.push(entry.name);
        diagnostics.push({
          code: 'PROJECT_NEEDS_REPAIR',
          projectId: entry.name,
          issues: ['PROJECT_METADATA_CORRUPT'],
        });
        continue;
      }

      const status = await this.inspectProject(project);
      projects.push({ project, repairStatus: status });
      if (status.state === 'needs-repair') {
        diagnostics.push({
          code: 'PROJECT_NEEDS_REPAIR',
          projectId: project.id,
          issues: status.issues,
        });
      }
    }

    const sorted = projects.sort(
      (left, right) =>
        right.project.updatedAt.localeCompare(left.project.updatedAt) ||
        right.project.id.localeCompare(left.project.id),
    );
    if (await this.rebuildIndex(sorted.map(({ project }) => project))) {
      diagnostics.push({ code: 'INDEX_REBUILT', projectCount: sorted.length });
    }
    const removedTransactionIds = this.removeStaleTransactions();
    removedTransactionIds.forEach((jobId) =>
      diagnostics.push({ code: 'STALE_TRANSACTION_REMOVED', jobId }),
    );
    diagnostics.forEach((diagnostic) => this.onDiagnostic?.(diagnostic));

    return { projects: sorted, corruptProjectIds, removedTransactionIds, diagnostics };
  }

  async inspectProject(project: SnapCutProject): Promise<ProjectRepairStatus> {
    const issues = new Set<ProjectRepairIssue>();
    const projectDirectory = this.layout.projectDirectoryUri(project.id);
    if (!(await this.recoverSourceDeletionTransactions(project))) {
      issues.add('INCOMPLETE_SOURCE_DELETE_TRANSACTION');
    }
    for (const source of project.sources) {
      const sourceDirectory = this.layout.sourceDirectoryUri(project.id, source.id);
      if (!this.layout.fileSystem.directoryExists(sourceDirectory)) {
        issues.add('SOURCE_DIRECTORY_MISSING');
        continue;
      }

      const sourceFile = await this.json.read(
        this.layout.sourceMetadataUri(project.id, source.id),
        (raw) => sourceFileSchema.parse(raw),
      );
      if (sourceFile === null) {
        issues.add('SOURCE_METADATA_INVALID');
      } else if (
        sourceFile.projectId !== project.id ||
        sourceFile.source.id !== source.id ||
        !sourceMetadataMatchesProjectSource(sourceFile.source, source)
      ) {
        issues.add('SOURCE_RELATION_MISMATCH');
      }
      if (source.privateAudioSha256 === null) {
        issues.add('PRIVATE_MEDIA_HASH_UNVERIFIED');
      }

      let audioUri: string;
      try {
        audioUri = this.layout.sourceAudioUri(project.id, source.id, source.privateAudioFileName);
      } catch {
        issues.add('SOURCE_RELATION_MISMATCH');
        continue;
      }
      if (
        !this.layout.fileSystem.fileExists(audioUri) ||
        this.layout.fileSystem.fileSize(audioUri) <= 0
      ) {
        issues.add('PRIVATE_MEDIA_MISSING_OR_EMPTY');
      } else if (this.layout.fileSystem.fileSize(audioUri) !== source.fileSizeBytes) {
        issues.add('PRIVATE_MEDIA_SIZE_MISMATCH');
      }

      if (source.waveformStatus === 'ready') {
        const waveformUri = this.layout.sourceWaveformUri(project.id, source.id);
        if (!this.layout.fileSystem.fileExists(waveformUri)) {
          issues.add('WAVEFORM_MISSING');
        } else {
          const waveform = await this.json.read(waveformUri, (raw) =>
            waveformFileSchema.parse(raw),
          );
          if (waveform === null) {
            issues.add('WAVEFORM_INVALID');
          } else if (waveform.durationMs !== source.durationMs) {
            issues.add('WAVEFORM_DURATION_MISMATCH');
          }
        }
      }
    }

    const journals = this.safeList(projectDirectory).filter(
      (entry) =>
        entry.kind === 'file' &&
        entry.name.startsWith(TRANSACTION_DIRECTORY_PREFIX) &&
        entry.name.endsWith(TRANSACTION_JOURNAL_SUFFIX),
    );
    for (const journalEntry of journals) {
      const journal = await this.json.read(journalEntry.uri, (raw) =>
        importTransactionJournalSchema.parse(raw),
      );
      if (journal === null || journal.projectId !== project.id) {
        issues.add('INCOMPLETE_IMPORT_TRANSACTION');
        continue;
      }
      const sourceIsCommitted = project.sources.some(({ id }) => id === journal.sourceId);
      if (sourceIsCommitted) {
        if (
          !(await this.completedJournalMatchesProject(journal, project)) ||
          !this.cleanupCompletedJournal(journalEntry.uri, journal)
        ) {
          issues.add('INCOMPLETE_IMPORT_TRANSACTION');
        }
        continue;
      }
      if (!this.rollbackUncommittedJournal(journalEntry.uri, journal)) {
        issues.add('INCOMPLETE_IMPORT_TRANSACTION');
      }
    }
    return repairStatus([...issues]);
  }

  private async recoverSourceDeletionTransactions(project: SnapCutProject): Promise<boolean> {
    let recovered = true;
    const projectDirectory = this.layout.projectDirectoryUri(project.id);
    const entries = this.safeList(projectDirectory).filter(
      (entry) =>
        entry.name.startsWith(SOURCE_DELETE_DIRECTORY_PREFIX) &&
        entry.name.endsWith(SOURCE_DELETE_JOURNAL_SUFFIX),
    );
    for (const entry of entries) {
      const fileJobId = this.layout.sourceDeleteJobIdFromJournalFileName(entry.name);
      if (
        entry.kind !== 'file' ||
        fileJobId === null ||
        entry.uri !== this.layout.projectSourceDeleteJournalUri(project.id, fileJobId)
      ) {
        recovered = false;
        continue;
      }
      const journal = await this.json.read(entry.uri, (raw) =>
        sourceDeletionJournalSchema.parse(raw),
      );
      if (journal === null || journal.projectId !== project.id || journal.jobId !== fileJobId) {
        recovered = false;
        continue;
      }
      const sourceDirectory = this.layout.sourceDirectoryUri(project.id, journal.sourceId);
      const deletionDirectory = this.layout.sourceDeleteDirectoryUri(fileJobId);
      if (!this.layout.isSourceDeleteDirectoryUri(deletionDirectory)) {
        recovered = false;
        continue;
      }
      const sourceReferenced = project.sources.some(({ id }) => id === journal.sourceId);
      try {
        if (sourceReferenced) {
          if (
            !this.layout.fileSystem.directoryExists(sourceDirectory) &&
            this.layout.fileSystem.directoryExists(deletionDirectory)
          ) {
            await this.layout.fileSystem.moveDirectory(deletionDirectory, sourceDirectory);
          }
          if (
            !this.layout.fileSystem.directoryExists(sourceDirectory) ||
            this.layout.fileSystem.directoryExists(deletionDirectory)
          ) {
            recovered = false;
            continue;
          }
        } else {
          if (this.layout.fileSystem.directoryExists(sourceDirectory)) {
            this.layout.fileSystem.deleteDirectory(sourceDirectory);
          }
          if (this.layout.fileSystem.directoryExists(deletionDirectory)) {
            this.layout.fileSystem.deleteDirectory(deletionDirectory);
          }
          if (
            this.layout.fileSystem.directoryExists(sourceDirectory) ||
            this.layout.fileSystem.directoryExists(deletionDirectory)
          ) {
            recovered = false;
            continue;
          }
        }
        this.layout.fileSystem.deleteFile(entry.uri);
        if (this.layout.fileSystem.fileExists(entry.uri)) recovered = false;
      } catch {
        recovered = false;
      }
    }
    return recovered;
  }

  async recoverJson<T>(
    destinationUri: string,
    parse: (raw: unknown) => T,
    canCommitTemporary: (temporary: T) => Promise<boolean> | boolean,
    diagnostics: RecoveryDiagnostic[] = [],
  ): Promise<T | null> {
    const committed = await this.json.read(destinationUri, parse);
    if (committed !== null) {
      return committed;
    }

    const backupUri = `${destinationUri}.bak`;
    const backup = await this.json.read(backupUri, parse);
    if (backup !== null) {
      try {
        await this.layout.fileSystem.copyFile(backupUri, destinationUri);
      } catch {
        return null;
      }
      const restored = await this.json.read(destinationUri, parse);
      if (restored !== null) {
        diagnostics.push({ code: 'JSON_BACKUP_RESTORED', uri: destinationUri });
      }
      return restored;
    }

    const temporaryUri = `${destinationUri}.tmp`;
    const temporary = await this.json.read(temporaryUri, parse);
    if (temporary === null || !(await canCommitTemporary(temporary))) {
      return null;
    }
    try {
      await this.layout.fileSystem.moveFile(temporaryUri, destinationUri);
    } catch {
      // Some providers report a move failure after completing it; validate below.
    }
    const recovered = await this.json.read(destinationUri, parse);
    if (recovered !== null) {
      diagnostics.push({ code: 'JSON_TEMP_COMMITTED', uri: destinationUri });
    }
    return recovered;
  }

  private async recoverProjectMetadata(
    entry: StorageEntry,
    diagnostics: RecoveryDiagnostic[],
  ): Promise<SnapCutProject | null> {
    const destinationUri = this.layout.fileSystem.join(entry.uri, PROJECT_FILE_NAME);
    const project = await this.recoverJson(
      destinationUri,
      (raw) => {
        const project = snapCutProjectSchema.parse(raw);
        if (project.id !== entry.name) {
          throw new Error('Project ID and directory name differ.');
        }
        return project;
      },
      (temporary) => this.journalProvesCommit(entry.uri, temporary),
      diagnostics,
    );
    return project;
  }

  private async journalProvesCommit(
    projectDirectoryUri: string,
    project: SnapCutProject,
  ): Promise<boolean> {
    for (const source of project.sources) {
      const journal = await this.findMatchingJournal(projectDirectoryUri, project, source.id);
      if (journal === null) {
        continue;
      }
      if (
        this.layout.fileSystem.directoryExists(this.layout.transactionDirectoryUri(journal.jobId))
      ) {
        return false;
      }
      const audioUri = this.layout.sourceAudioUri(
        project.id,
        source.id,
        source.privateAudioFileName,
      );
      if (
        this.layout.fileSystem.fileExists(audioUri) &&
        this.layout.fileSystem.fileSize(audioUri) === journal.expectedFileSizeBytes &&
        source.fileSizeBytes === journal.expectedFileSizeBytes &&
        source.privateAudioSha256 === journal.expectedSha256 &&
        (await this.privateMediaMatches(
          audioUri,
          journal.expectedFileSizeBytes,
          journal.expectedSha256,
        ))
      ) {
        const sourceFile = await this.json.read(
          this.layout.sourceMetadataUri(project.id, source.id),
          (raw) => sourceFileSchema.parse(raw),
        );
        if (
          sourceFile !== null &&
          sourceFile.projectId === project.id &&
          sourceMetadataMatchesProjectSource(sourceFile.source, source)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private async completedJournalMatchesProject(
    journal: ImportTransactionJournal,
    project: SnapCutProject,
  ): Promise<boolean> {
    if (journal.projectId !== project.id || !journal.nativeInspectionComplete) {
      return false;
    }
    const source = project.sources.find(({ id }) => id === journal.sourceId);
    if (
      source === undefined ||
      source.privateAudioFileName !== journal.privateAudioFileName ||
      source.privateAudioSha256 !== journal.expectedSha256 ||
      source.fileSizeBytes !== journal.expectedFileSizeBytes
    ) {
      return false;
    }
    const audioUri = this.layout.sourceAudioUri(project.id, source.id, source.privateAudioFileName);
    if (!(
      this.layout.fileSystem.fileExists(audioUri) &&
      this.layout.fileSystem.fileSize(audioUri) === journal.expectedFileSizeBytes &&
      (await this.privateMediaMatches(
        audioUri,
        journal.expectedFileSizeBytes,
        journal.expectedSha256,
      ))
    )) {
      return false;
    }
    const sourceFile = await this.json.read(
      this.layout.sourceMetadataUri(project.id, source.id),
      (raw) => sourceFileSchema.parse(raw),
    );
    return (
      sourceFile !== null &&
      sourceFile.projectId === project.id &&
      sourceMetadataMatchesProjectSource(sourceFile.source, source)
    );
  }

  private async privateMediaMatches(
    fileUri: string,
    expectedFileSizeBytes: number,
    expectedSha256: string,
  ): Promise<boolean> {
    if (this.privateMediaVerifier === undefined) return false;
    let verification: PrivateMediaVerification;
    try {
      verification = await this.privateMediaVerifier.verifyPrivateMedia(fileUri);
    } catch {
      return false;
    }
    return (
      Number.isSafeInteger(verification.fileSizeBytes) &&
      verification.fileSizeBytes > 0 &&
      SHA256_PATTERN.test(verification.sha256) &&
      verification.fileSizeBytes === expectedFileSizeBytes &&
      verification.sha256 === expectedSha256
    );
  }

  private cleanupCompletedJournal(journalUri: string, journal: ImportTransactionJournal): boolean {
    if (this.activeJobIds().has(journal.jobId)) return false;
    const transactionUri = this.layout.transactionDirectoryUri(journal.jobId);
    try {
      if (this.layout.fileSystem.directoryExists(transactionUri)) {
        this.layout.fileSystem.deleteDirectory(transactionUri);
      }
      if (this.layout.fileSystem.directoryExists(transactionUri)) return false;
      this.layout.fileSystem.deleteFile(journalUri);
      return !this.layout.fileSystem.fileExists(journalUri);
    } catch {
      return false;
    }
  }

  private rollbackUncommittedJournal(
    journalUri: string,
    journal: ImportTransactionJournal,
  ): boolean {
    if (this.activeJobIds().has(journal.jobId)) return false;
    const finalSourceDirectory = this.layout.sourceDirectoryUri(
      journal.projectId,
      journal.sourceId,
    );
    const transactionUri = this.layout.transactionDirectoryUri(journal.jobId);
    try {
      if (this.layout.fileSystem.directoryExists(finalSourceDirectory)) {
        this.layout.fileSystem.deleteDirectory(finalSourceDirectory);
      }
      if (this.layout.fileSystem.directoryExists(finalSourceDirectory)) return false;
      if (this.layout.fileSystem.directoryExists(transactionUri)) {
        this.layout.fileSystem.deleteDirectory(transactionUri);
      }
      if (this.layout.fileSystem.directoryExists(transactionUri)) return false;
      this.layout.fileSystem.deleteFile(journalUri);
      return !this.layout.fileSystem.fileExists(journalUri);
    } catch {
      return false;
    }
  }

  private async findMatchingJournal(
    projectDirectoryUri: string,
    project: SnapCutProject,
    sourceId: string,
  ): Promise<ImportTransactionJournal | null> {
    for (const entry of this.safeList(projectDirectoryUri)) {
      if (
        entry.kind !== 'file' ||
        !entry.name.startsWith(TRANSACTION_DIRECTORY_PREFIX) ||
        !entry.name.endsWith(TRANSACTION_JOURNAL_SUFFIX)
      ) {
        continue;
      }
      const journal = await this.json.read(entry.uri, (raw) =>
        importTransactionJournalSchema.parse(raw),
      );
      if (
        journal !== null &&
        journal.projectId === project.id &&
        journal.sourceId === sourceId &&
        journal.projectUpdatedAt === project.updatedAt &&
        journal.nativeInspectionComplete
      ) {
        return journal;
      }
    }
    return null;
  }

  private async rebuildIndex(projects: readonly SnapCutProject[]): Promise<boolean> {
    const expected = projectIndexSchema.parse({
      schemaVersion: 1 as const,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        sourceCount: project.sources.length,
        clipCount: project.clips.length,
        compositionDurationMs: compositionDurationMs(project.clips),
      })),
    });
    try {
      const current = projectIndexSchema.parse(
        JSON.parse(await this.layout.fileSystem.readText(this.layout.indexUri)),
      );
      if (JSON.stringify(current) === JSON.stringify(expected)) return false;
    } catch {
      // Missing or invalid cache is rebuilt from authoritative project folders.
    }
    try {
      await this.json.write(
        this.layout.indexUri,
        expected,
        (raw) => projectIndexSchema.parse(raw),
        { preserveInvalidCommitted: true },
      );
      return true;
    } catch {
      // Project directories remain authoritative and can retry this cache later.
      return false;
    }
  }

  private removeStaleTransactions(): string[] {
    const active = this.activeJobIds();
    const removed: string[] = [];
    for (const entry of this.safeList(this.layout.stagingDirectoryUri)) {
      if (
        entry.kind !== 'directory' ||
        !entry.name.startsWith(TRANSACTION_DIRECTORY_PREFIX) ||
        entry.lastModifiedMs === null ||
        entry.lastModifiedMs >= this.now() - STALE_TRANSACTION_AGE_MS
      ) {
        continue;
      }
      const jobId = entry.name.slice(TRANSACTION_DIRECTORY_PREFIX.length);
      if (active.has(jobId) || !this.layout.isTransactionDirectoryUri(entry.uri)) {
        continue;
      }
      try {
        this.layout.fileSystem.deleteDirectory(entry.uri);
        if (!this.layout.fileSystem.directoryExists(entry.uri)) {
          removed.push(jobId);
        }
      } catch {
        // Keep app-owned staging for a later recovery attempt.
      }
    }
    return removed;
  }

  private safeList(uri: string): readonly StorageEntry[] {
    try {
      return this.layout.fileSystem.listDirectory(uri);
    } catch {
      return [];
    }
  }
}

export const recoveryService = new RecoveryService();

// Referenced here to make the cache-only role explicit and keep name drift visible.
void INDEX_FILE_NAME;
void SOURCE_METADATA_FILE_NAME;
void WAVEFORM_FILE_NAME;
