import {
  addClip,
  createProject,
  immutableSourceMetadata,
  removeUnusedSource,
  snapCutProjectSchema,
  sourceFileSchema,
  type SnapCutClip,
  type SnapCutProject,
  type SnapCutSource,
} from '@/domain';
import { AtomicJsonStore } from '@/repositories/AtomicJsonStore';
import { ProjectRepository } from '@/repositories/ProjectRepository';
import { sourceDeletionJournalSchema } from '@/repositories/SourceDeletionTransaction';
import {
  CURRENT_STORAGE_GENERATION,
  StorageGenerationService,
} from '@/repositories/StorageGenerationService';
import { StorageLayout } from '@/repositories/StorageLayout';
import { RecoveryService } from '@/services/RecoveryService';

import { MemoryStorageFileSystem } from './support/MemoryStorageFileSystem';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const CLIP_ID = '33333333-3333-4333-8333-333333333333';
const DELETE_JOB_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_DELETE_JOB_ID = '66666666-6666-4666-8666-666666666666';
const SHA = 'a'.repeat(64);
const FILE_SIZE = 4_096;

function importedSource(overrides: Partial<SnapCutSource> = {}): SnapCutSource {
  return {
    id: SOURCE_ID,
    displayName: 'S1',
    originalMimeType: null,
    sourceKind: 'm4a',
    privateAudioFileName: 'source.m4a',
    durationMs: 12_000,
    codecMime: 'audio/mp4a-latm',
    sampleRateHz: 48_000,
    channelCount: 2,
    encodedBitrateBps: 256_000,
    pcmBitsPerSample: null,
    aacProfile: 'aac-lc',
    codecConfigFingerprint: 'b'.repeat(64),
    encoderDelayFrames: 0,
    encoderPaddingFrames: 0,
    privateAudioSha256: SHA,
    fileSizeBytes: FILE_SIZE,
    waveformFileName: 'waveform.json',
    waveformStatus: 'pending',
    createdAt: '2026-08-14T12:00:01.000Z',
    ...overrides,
  };
}

function clock(): () => string {
  let tick = 0;
  return () => `2026-08-14T12:00:${String(tick++).padStart(2, '0')}.000Z`;
}

async function setupImportedProject() {
  const fileSystem = new MemoryStorageFileSystem();
  const layout = new StorageLayout(fileSystem);
  const verifier = {
    verifyPrivateMedia: jest.fn(async (uri: string) => ({
      fileSizeBytes: fileSystem.fileSize(uri),
      sha256: SHA,
    })),
  };
  const repository = new ProjectRepository({
    layout,
    privateMediaVerifier: verifier,
    now: clock(),
    idFactory: () => DELETE_JOB_ID,
  });
  await repository.initialize();
  await repository.create({ id: PROJECT_ID, name: 'Project' });
  const paths = repository.beginImport({
    jobId: 'import-job',
    projectId: PROJECT_ID,
    sourceId: SOURCE_ID,
    privateAudioFileName: 'source.m4a',
  });
  fileSystem.writeMedia(paths.outputFileUri, FILE_SIZE);
  const project = await repository.finalizeImport({
    jobId: 'import-job',
    projectId: PROJECT_ID,
    source: importedSource(),
    privateAudioSha256: SHA,
  });
  return { fileSystem, layout, verifier, repository, project };
}

function seedPendingSourceDeletion(
  fileSystem: MemoryStorageFileSystem,
  layout: StorageLayout,
  projectId: string,
  options: {
    fileJobId?: string;
    journal?: unknown;
  } = {},
): { journalUri: string; deletionDirectoryUri: string } {
  const fileJobId = options.fileJobId ?? DELETE_JOB_ID;
  const deletionDirectoryUri = layout.sourceDeleteDirectoryUri(DELETE_JOB_ID);
  fileSystem.ensureDirectory(deletionDirectoryUri);
  fileSystem.writeMedia(fileSystem.join(deletionDirectoryUri, 'source.m4a'), 512);
  const journalUri = layout.projectSourceDeleteJournalUri(projectId, fileJobId);
  const journal =
    options.journal ??
    sourceDeletionJournalSchema.parse({
      schemaVersion: 1,
      jobId: DELETE_JOB_ID,
      projectId,
      sourceId: SOURCE_ID,
      projectUpdatedAt: '2026-08-14T12:00:59.000Z',
    });
  fileSystem.writeText(journalUri, JSON.stringify(journal));
  return { journalUri, deletionDirectoryUri };
}

async function setupCorruptProject(options: { journal?: unknown } = {}) {
  const fileSystem = new MemoryStorageFileSystem();
  const layout = new StorageLayout(fileSystem);
  layout.ensureBaseDirectories();
  fileSystem.writeText(
    layout.storageGenerationUri,
    JSON.stringify({ schemaVersion: 1, generation: CURRENT_STORAGE_GENERATION }),
  );
  fileSystem.ensureDirectory(layout.projectDirectoryUri(PROJECT_ID));
  fileSystem.writeText(layout.projectMetadataUri(PROJECT_ID), '{broken');
  const pending = seedPendingSourceDeletion(fileSystem, layout, PROJECT_ID, options);
  const repository = new ProjectRepository({ layout, now: clock() });
  await repository.initialize();
  expect(repository.listCorruptProjectIds()).toContain(PROJECT_ID);
  return { fileSystem, layout, repository, ...pending };
}

describe('storage generation reset', () => {
  it('removes only old private editing state and writes the marker last', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const layout = new StorageLayout(fileSystem);
    layout.ensureBaseDirectories();
    const diagnosticsUri = fileSystem.join(layout.rootUri, 'diagnostics.json');
    const legacyCorruptIndexUri = fileSystem.join(
      layout.rootUri,
      'index.json.corrupt-1723590000000',
    );
    const nonMatchingCorruptUri = fileSystem.join(
      layout.rootUri,
      'index.json.corrupt-not-a-timestamp',
    );
    const unrelatedUri = fileSystem.join(layout.rootUri, 'keep-me.json');
    fileSystem.writeText(diagnosticsUri, '{"keep":true}');
    fileSystem.writeText(legacyCorruptIndexUri, '{"legacy":true}');
    fileSystem.writeText(nonMatchingCorruptUri, '{"keep":true}');
    fileSystem.writeText(unrelatedUri, '{"keep":true}');
    fileSystem.writeText(layout.indexUri, '{"legacy":true}');
    fileSystem.writeText(fileSystem.join(layout.projectsDirectoryUri, 'old', 'project.json'), '{}');
    fileSystem.writeMedia(
      fileSystem.join(layout.stagingDirectoryUri, '.import-old', 'partial'),
      20,
    );

    await expect(new StorageGenerationService(layout).ensureCurrentGeneration()).resolves.toBe(
      true,
    );
    expect(fileSystem.fileExists(diagnosticsUri)).toBe(true);
    expect(fileSystem.fileExists(legacyCorruptIndexUri)).toBe(false);
    expect(fileSystem.fileExists(nonMatchingCorruptUri)).toBe(true);
    expect(fileSystem.fileExists(unrelatedUri)).toBe(true);
    expect(fileSystem.listDirectory(layout.projectsDirectoryUri)).toEqual([]);
    expect(fileSystem.listDirectory(layout.stagingDirectoryUri)).toEqual([]);
    expect(fileSystem.fileExists(layout.indexUri)).toBe(false);
    await expect(fileSystem.readText(layout.storageGenerationUri)).resolves.toContain(
      '"generation":7',
    );
    await expect(new StorageGenerationService(layout).ensureCurrentGeneration()).resolves.toBe(
      false,
    );
  });

  it('does not write a marker until every cleanup target succeeds and retries safely', async () => {
    const fileSystem = new MemoryStorageFileSystem();
    const layout = new StorageLayout(fileSystem);
    layout.ensureBaseDirectories();
    fileSystem.writeMedia(
      fileSystem.join(layout.stagingDirectoryUri, '.import-old', 'partial'),
      20,
    );
    const originalDelete = fileSystem.deleteDirectory.bind(fileSystem);
    const deletion = jest.spyOn(fileSystem, 'deleteDirectory').mockImplementation((uri) => {
      if (uri === layout.stagingDirectoryUri) throw new Error('interrupted');
      originalDelete(uri);
    });
    await expect(new StorageGenerationService(layout).ensureCurrentGeneration()).rejects.toThrow(
      'interrupted',
    );
    expect(fileSystem.fileExists(layout.storageGenerationUri)).toBe(false);
    deletion.mockRestore();
    await expect(new StorageGenerationService(layout).ensureCurrentGeneration()).resolves.toBe(
      true,
    );
  });
});

describe('import and source lifecycle repository', () => {
  it('commits import as Source only and writes an immutable v2 manifest', async () => {
    const { fileSystem, layout, project } = await setupImportedProject();
    expect(project.sources).toHaveLength(1);
    expect(project.clips).toEqual([]);
    const manifest = sourceFileSchema.parse(
      JSON.parse(await fileSystem.readText(layout.sourceMetadataUri(PROJECT_ID, SOURCE_ID))),
    );
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.source).toEqual(immutableSourceMetadata(project.sources[0]!));
    expect(manifest.source).not.toHaveProperty('displayName');
    expect(manifest.source).not.toHaveProperty('waveformStatus');
  });

  it('renames duplicate-friendly source metadata without creating a repair mismatch', async () => {
    const { repository } = await setupImportedProject();
    const renamed = await repository.renameSource(PROJECT_ID, SOURCE_ID, '  音乐🎵  ');
    expect(renamed.sources[0]?.displayName).toBe('音乐🎵');
    await expect(repository.renameSource(PROJECT_ID, SOURCE_ID, '1234567')).rejects.toThrow(
      'Source name must contain 1 to 6 Unicode characters.',
    );
    expect(repository.get(PROJECT_ID)?.sources[0]?.displayName).toBe('音乐🎵');
    expect(repository.getRepairStatus(PROJECT_ID)).toEqual({ state: 'ready', issues: [] });
  });

  it('rejects deleting a referenced source with stable SOURCE_IN_USE', async () => {
    const { repository, project } = await setupImportedProject();
    const clip: SnapCutClip = {
      id: CLIP_ID,
      sourceId: SOURCE_ID,
      startMs: 0,
      endMs: 1_000,
    };
    await repository.save(addClip(project, clip, project.updatedAt));
    await expect(repository.deleteSource(PROJECT_ID, SOURCE_ID)).rejects.toMatchObject({
      code: 'SOURCE_IN_USE',
    });
  });

  it('prepares media outside the write queue and deletes an unused private source', async () => {
    const { fileSystem, layout, repository } = await setupImportedProject();
    const prepare = jest.fn(async (projectId: string, sourceId: string) => {
      // Simulates waveform cancellation persisting its terminal status through
      // the same keyed repository queue; this would deadlock if prepare ran in it.
      await repository.updateSourceWaveformStatus(projectId, sourceId, 'pending');
    });
    repository.configureSourceDeletionLifecycle({ prepare });
    const deleted = await repository.deleteSource(PROJECT_ID, SOURCE_ID);
    expect(prepare).toHaveBeenCalledWith(PROJECT_ID, SOURCE_ID);
    expect(deleted.sources).toEqual([]);
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID))).toBe(
      false,
    );
  });

  it('accepts a project commit that throws afterward and completes source deletion', async () => {
    const { fileSystem, layout, repository } = await setupImportedProject();
    fileSystem.throwOnDeleteFileUri = `${layout.projectMetadataUri(PROJECT_ID)}.bak`;
    await expect(repository.deleteSource(PROJECT_ID, SOURCE_ID)).resolves.toMatchObject({
      sources: [],
    });
    expect(repository.get(PROJECT_ID)?.sources).toEqual([]);
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID))).toBe(
      false,
    );
  });

  it('reports ready after a one-shot staging delete failure succeeds on inspection retry', async () => {
    const { fileSystem, layout, repository } = await setupImportedProject();
    const deletionDirectoryUri = layout.sourceDeleteDirectoryUri(DELETE_JOB_ID);
    const journalUri = layout.projectSourceDeleteJournalUri(PROJECT_ID, DELETE_JOB_ID);
    const originalDelete = fileSystem.deleteDirectory.bind(fileSystem);
    let deletionAttempts = 0;
    const deletion = jest.spyOn(fileSystem, 'deleteDirectory').mockImplementation((uri) => {
      if (uri === deletionDirectoryUri && deletionAttempts++ === 0) {
        throw new Error('provider rate limited');
      }
      originalDelete(uri);
    });

    await repository.deleteSource(PROJECT_ID, SOURCE_ID);

    expect(deletionAttempts).toBe(2);
    expect(fileSystem.directoryExists(deletionDirectoryUri)).toBe(false);
    expect(fileSystem.fileExists(journalUri)).toBe(false);
    expect(repository.getRepairStatus(PROJECT_ID)).toEqual({ state: 'ready', issues: [] });
    deletion.mockRestore();
  });

  it('keeps an accurate repair status when every staging cleanup attempt fails', async () => {
    const { fileSystem, layout, repository } = await setupImportedProject();
    const deletionDirectoryUri = layout.sourceDeleteDirectoryUri(DELETE_JOB_ID);
    const journalUri = layout.projectSourceDeleteJournalUri(PROJECT_ID, DELETE_JOB_ID);
    const originalDelete = fileSystem.deleteDirectory.bind(fileSystem);
    const deletion = jest.spyOn(fileSystem, 'deleteDirectory').mockImplementation((uri) => {
      if (uri === deletionDirectoryUri) throw new Error('persistent provider failure');
      originalDelete(uri);
    });

    await repository.deleteSource(PROJECT_ID, SOURCE_ID);

    expect(fileSystem.directoryExists(deletionDirectoryUri)).toBe(true);
    expect(fileSystem.fileExists(journalUri)).toBe(true);
    expect(repository.getRepairStatus(PROJECT_ID)).toEqual({
      state: 'needs-repair',
      issues: ['INCOMPLETE_SOURCE_DELETE_TRANSACTION'],
    });
    deletion.mockRestore();
  });
});

describe('project deletion source-trash containment', () => {
  it('cleans pending source-delete staging before deleting a healthy project', async () => {
    const { fileSystem, layout, repository } = await setupImportedProject();
    const { deletionDirectoryUri } = seedPendingSourceDeletion(fileSystem, layout, PROJECT_ID);

    await repository.delete(PROJECT_ID);

    expect(fileSystem.directoryExists(deletionDirectoryUri)).toBe(false);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
  });

  it('cleans pending source-delete staging before deleting a corrupt project', async () => {
    const { fileSystem, layout, repository, deletionDirectoryUri } = await setupCorruptProject();

    await repository.deleteCorruptProject(PROJECT_ID);

    expect(fileSystem.directoryExists(deletionDirectoryUri)).toBe(false);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
  });

  it('fails closed when staging cleanup fails and keeps the project journal', async () => {
    const { fileSystem, layout, repository } = await setupImportedProject();
    const { journalUri, deletionDirectoryUri } = seedPendingSourceDeletion(
      fileSystem,
      layout,
      PROJECT_ID,
    );
    const originalDelete = fileSystem.deleteDirectory.bind(fileSystem);
    const deletion = jest.spyOn(fileSystem, 'deleteDirectory').mockImplementation((uri) => {
      if (uri === deletionDirectoryUri) throw new Error('cleanup failed');
      originalDelete(uri);
    });

    await expect(repository.delete(PROJECT_ID)).rejects.toMatchObject({
      code: 'PROJECT_DELETE_FAILED',
    });

    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.directoryExists(deletionDirectoryUri)).toBe(true);
    expect(fileSystem.fileExists(journalUri)).toBe(true);
    deletion.mockRestore();
  });

  it('does not follow a valid journal that names another project', async () => {
    const crossProjectJournal = sourceDeletionJournalSchema.parse({
      schemaVersion: 1,
      jobId: DELETE_JOB_ID,
      projectId: OTHER_PROJECT_ID,
      sourceId: SOURCE_ID,
      projectUpdatedAt: '2026-08-14T12:00:59.000Z',
    });
    const { fileSystem, layout, repository, deletionDirectoryUri } = await setupCorruptProject({
      journal: crossProjectJournal,
    });

    await expect(repository.deleteCorruptProject(PROJECT_ID)).rejects.toMatchObject({
      code: 'PROJECT_DELETE_FAILED',
    });
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.directoryExists(deletionDirectoryUri)).toBe(true);
  });

  it('does not derive a path from an invalid journal job ID', async () => {
    const { fileSystem, layout, repository, deletionDirectoryUri } = await setupCorruptProject({
      journal: {
        schemaVersion: 1,
        jobId: '../outside',
        projectId: PROJECT_ID,
        sourceId: SOURCE_ID,
        projectUpdatedAt: '2026-08-14T12:00:59.000Z',
      },
    });
    const unrelatedUri = fileSystem.join(layout.stagingDirectoryUri, 'unrelated');
    fileSystem.ensureDirectory(unrelatedUri);

    await expect(repository.deleteCorruptProject(PROJECT_ID)).rejects.toMatchObject({
      code: 'PROJECT_DELETE_FAILED',
    });
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
    expect(fileSystem.directoryExists(deletionDirectoryUri)).toBe(true);
    expect(fileSystem.directoryExists(unrelatedUri)).toBe(true);
  });
});

describe('source deletion crash recovery', () => {
  async function seedDeletionTransaction(projectCommitted: boolean) {
    const setup = await setupImportedProject();
    const { fileSystem, layout, project } = setup;
    const json = new AtomicJsonStore(fileSystem);
    const updated = removeUnusedSource(project, SOURCE_ID, '2026-08-14T12:00:59.000Z');
    const journal = sourceDeletionJournalSchema.parse({
      schemaVersion: 1,
      jobId: DELETE_JOB_ID,
      projectId: PROJECT_ID,
      sourceId: SOURCE_ID,
      projectUpdatedAt: updated.updatedAt,
    });
    await json.write(
      layout.projectSourceDeleteJournalUri(PROJECT_ID, DELETE_JOB_ID),
      journal,
      (raw) => sourceDeletionJournalSchema.parse(raw),
    );
    await fileSystem.moveDirectory(
      layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID),
      layout.sourceDeleteDirectoryUri(DELETE_JOB_ID),
    );
    if (projectCommitted) {
      await json.write(layout.projectMetadataUri(PROJECT_ID), updated, (raw) => snapProject(raw));
    }
    return { ...setup, updated };
  }

  function snapProject(raw: unknown): SnapCutProject {
    return snapCutProjectSchema.parse(raw) as SnapCutProject;
  }

  it('restores source files when project.json still references the source', async () => {
    const { fileSystem, layout } = await seedDeletionTransaction(false);
    const report = await new RecoveryService(layout).recover();
    expect(report.projects[0]?.repairStatus).toEqual({ state: 'ready', issues: [] });
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID))).toBe(true);
    expect(fileSystem.directoryExists(layout.sourceDeleteDirectoryUri(DELETE_JOB_ID))).toBe(false);
  });

  it('finishes deleting app-private files when project.json no longer references them', async () => {
    const { fileSystem, layout } = await seedDeletionTransaction(true);
    const report = await new RecoveryService(layout).recover();
    expect(report.projects[0]?.project.sources).toEqual([]);
    expect(fileSystem.directoryExists(layout.sourceDeleteDirectoryUri(DELETE_JOB_ID))).toBe(false);
    expect(
      fileSystem.fileExists(layout.projectSourceDeleteJournalUri(PROJECT_ID, DELETE_JOB_ID)),
    ).toBe(false);
  });

  it('does not follow a journal job ID that differs from its strict filename binding', async () => {
    const { fileSystem, layout, updated } = await seedDeletionTransaction(true);
    const journalUri = layout.projectSourceDeleteJournalUri(PROJECT_ID, DELETE_JOB_ID);
    const otherDeletionDirectory = layout.sourceDeleteDirectoryUri(OTHER_DELETE_JOB_ID);
    fileSystem.ensureDirectory(otherDeletionDirectory);
    fileSystem.writeMedia(fileSystem.join(otherDeletionDirectory, 'foreign-private-media'), 128);
    fileSystem.writeText(
      journalUri,
      JSON.stringify({
        schemaVersion: 1,
        jobId: OTHER_DELETE_JOB_ID,
        projectId: PROJECT_ID,
        sourceId: SOURCE_ID,
        projectUpdatedAt: updated.updatedAt,
      }),
    );

    const report = await new RecoveryService(layout).recover();

    expect(report.projects[0]?.repairStatus).toEqual({
      state: 'needs-repair',
      issues: ['INCOMPLETE_SOURCE_DELETE_TRANSACTION'],
    });
    expect(fileSystem.directoryExists(layout.sourceDeleteDirectoryUri(DELETE_JOB_ID))).toBe(true);
    expect(fileSystem.directoryExists(otherDeletionDirectory)).toBe(true);
    expect(fileSystem.fileExists(journalUri)).toBe(true);
  });

  it('does not touch staging for a journal owned by another project', async () => {
    const { fileSystem, layout, updated } = await seedDeletionTransaction(true);
    const journalUri = layout.projectSourceDeleteJournalUri(PROJECT_ID, DELETE_JOB_ID);
    const deletionDirectory = layout.sourceDeleteDirectoryUri(DELETE_JOB_ID);
    fileSystem.writeText(
      journalUri,
      JSON.stringify({
        schemaVersion: 1,
        jobId: DELETE_JOB_ID,
        projectId: OTHER_PROJECT_ID,
        sourceId: SOURCE_ID,
        projectUpdatedAt: updated.updatedAt,
      }),
    );

    const report = await new RecoveryService(layout).recover();

    expect(report.projects[0]?.repairStatus).toEqual({
      state: 'needs-repair',
      issues: ['INCOMPLETE_SOURCE_DELETE_TRANSACTION'],
    });
    expect(fileSystem.directoryExists(deletionDirectory)).toBe(true);
    expect(fileSystem.fileExists(journalUri)).toBe(true);
  });
});
