import { parseSnapCutProject } from '@/domain/migrations';
import type { SnapCutProject, SnapCutSource } from '@/domain/types';
import { AtomicJsonStore } from '@/repositories/AtomicJsonStore';
import { ProjectRepository } from '@/repositories/ProjectRepository';
import type { PrivateMediaVerifier } from '@/repositories/ImportTransaction';
import { StorageLayout } from '@/repositories/StorageLayout';
import { RecoveryService, STALE_TRANSACTION_AGE_MS } from '@/services/RecoveryService';
import { MemoryStorageFileSystem } from './support/MemoryStorageFileSystem';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const CLIP_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = 'job-1';
const NOW = '2026-08-12T23:00:00.000Z';
const HASH = 'a'.repeat(64);

function verifier(
  result: { fileSizeBytes: number; sha256: string } = { fileSizeBytes: 500, sha256: HASH },
): PrivateMediaVerifier {
  return { verifyPrivateMedia: jest.fn().mockResolvedValue(result) };
}

function project(name = 'Project'): SnapCutProject {
  return {
    schemaVersion: 6,
    namePromptCompleted: true,
    id: PROJECT_ID,
    name,
    createdAt: NOW,
    updatedAt: NOW,
    sources: [],
    trackCount: 2,
    clips: [],
    lastExport: null,
  };
}

function source(): SnapCutSource {
  return {
    id: SOURCE_ID,
    displayName: 'Song.m4a',
    originalMimeType: 'audio/mp4',
    sourceKind: 'm4a',
    privateAudioFileName: 'source.m4a',
    privateAudioSha256: HASH,
    durationMs: 1000,
    codecMime: 'audio/mp4a-latm',
    sampleRateHz: 44100,
    channelCount: 2,
    encodedBitrateBps: 256000,
    pcmBitsPerSample: null,
    aacProfile: 'aac-lc',
    codecConfigFingerprint: 'b'.repeat(64),
    encoderDelayFrames: 0,
    encoderPaddingFrames: 0,
    fileSizeBytes: 500,
    waveformFileName: 'waveform.json',
    waveformStatus: 'pending',
    createdAt: NOW,
  };
}

function setup() {
  const fileSystem = new MemoryStorageFileSystem();
  const layout = new StorageLayout(fileSystem);
  layout.ensureBaseDirectories();
  return { fileSystem, layout };
}

async function seedProject(
  layout: StorageLayout,
  value: SnapCutProject,
  suffix = '',
): Promise<void> {
  layout.fileSystem.ensureDirectory(layout.projectDirectoryUri(value.id));
  layout.fileSystem.ensureDirectory(layout.projectSourcesDirectoryUri(value.id));
  layout.fileSystem.writeText(
    `${layout.projectMetadataUri(value.id)}${suffix}`,
    JSON.stringify(value),
  );
}

function seedImportJournal(
  fileSystem: MemoryStorageFileSystem,
  layout: StorageLayout,
  projectUpdatedAt = NOW,
): void {
  fileSystem.writeText(
    layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID),
    JSON.stringify({
      schemaVersion: 1,
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      sourceId: SOURCE_ID,
      privateAudioFileName: 'source.m4a',
      expectedFileSizeBytes: 500,
      expectedSha256: HASH,
      projectUpdatedAt,
      nativeInspectionComplete: true,
    }),
  );
}

function seedFinalSource(fileSystem: MemoryStorageFileSystem, layout: StorageLayout): void {
  fileSystem.ensureDirectory(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID));
  fileSystem.writeMedia(layout.sourceAudioUri(PROJECT_ID, SOURCE_ID, 'source.m4a'), 500);
  fileSystem.writeText(
    layout.sourceMetadataUri(PROJECT_ID, SOURCE_ID),
    JSON.stringify({ schemaVersion: 1, projectId: PROJECT_ID, source: source() }),
  );
}

async function setupStagedImport(privateMediaVerifier?: PrivateMediaVerifier) {
  const { fileSystem, layout } = setup();
  const repository = new ProjectRepository({
    layout,
    now: () => NOW,
    idFactory: () => PROJECT_ID,
    ...(privateMediaVerifier === undefined ? {} : { privateMediaVerifier }),
  });
  await repository.initialize();
  await repository.create({ name: 'Import' });
  const paths = repository.beginImport({
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    sourceId: SOURCE_ID,
    privateAudioFileName: 'source.m4a',
  });
  fileSystem.writeMedia(paths.outputFileUri, 500);
  return { fileSystem, layout, repository, paths };
}

describe('atomic JSON storage and startup recovery', () => {
  it('rebuilds a missing index once and leaves an unchanged cache untouched later', async () => {
    const { layout } = setup();
    await seedProject(layout, project('Indexed'));
    const recovery = new RecoveryService(layout, { privateMediaVerifier: verifier() });

    const first = await recovery.recover();
    const second = await recovery.recover();

    expect(first.diagnostics).toContainEqual({ code: 'INDEX_REBUILT', projectCount: 1 });
    expect(second.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'INDEX_REBUILT' }),
    );
  });

  it('atomically persists a recovered schema v2 project as v6 without prompting', async () => {
    const { fileSystem, layout } = setup();
    const current = project('Legacy v2');
    const { namePromptCompleted: _completed, trackCount: _trackCount, ...withoutPrompt } = current;
    fileSystem.ensureDirectory(layout.projectDirectoryUri(PROJECT_ID));
    fileSystem.ensureDirectory(layout.projectSourcesDirectoryUri(PROJECT_ID));
    fileSystem.writeText(
      layout.projectMetadataUri(PROJECT_ID),
      JSON.stringify({ ...withoutPrompt, schemaVersion: 2 }),
    );

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();
    const persisted = JSON.parse(
      await fileSystem.readText(layout.projectMetadataUri(PROJECT_ID)),
    ) as Record<string, unknown>;

    expect(report.projects[0]?.project).toMatchObject({
      schemaVersion: 6,
      trackCount: 2,
      name: 'Legacy v2',
      namePromptCompleted: true,
    });
    expect(persisted).toMatchObject({
      schemaVersion: 6,
      trackCount: 2,
      namePromptCompleted: true,
    });
    expect(fileSystem.fileExists(`${layout.projectMetadataUri(PROJECT_ID)}.tmp`)).toBe(false);
    expect(fileSystem.fileExists(`${layout.projectMetadataUri(PROJECT_ID)}.bak`)).toBe(false);
  });

  it('writes temp, verifies it, backs up final, and commits in the same directory', async () => {
    const { fileSystem, layout } = setup();
    const json = new AtomicJsonStore(fileSystem);
    await seedProject(layout, project('Old'));

    await json.write(layout.projectMetadataUri(PROJECT_ID), project('New'), parseSnapCutProject);

    expect(JSON.parse(await fileSystem.readText(layout.projectMetadataUri(PROJECT_ID))).name).toBe(
      'New',
    );
    expect(fileSystem.fileExists(`${layout.projectMetadataUri(PROJECT_ID)}.tmp`)).toBe(false);
    expect(fileSystem.fileExists(`${layout.projectMetadataUri(PROJECT_ID)}.bak`)).toBe(false);
    expect(fileSystem.moves).toEqual(
      expect.arrayContaining([
        {
          source: layout.projectMetadataUri(PROJECT_ID),
          destination: `${layout.projectMetadataUri(PROJECT_ID)}.bak`,
        },
        {
          source: `${layout.projectMetadataUri(PROJECT_ID)}.tmp`,
          destination: layout.projectMetadataUri(PROJECT_ID),
        },
      ]),
    );
  });

  it('prefers a valid final over backup and temporary metadata', async () => {
    const { fileSystem, layout } = setup();
    await seedProject(layout, project('Final'));
    await seedProject(layout, project('Backup'), '.bak');
    await seedProject(layout, project('Temporary'), '.tmp');

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();

    expect(report.projects[0]?.project.name).toBe('Final');
    expect(JSON.parse(await fileSystem.readText(layout.projectMetadataUri(PROJECT_ID))).name).toBe(
      'Final',
    );
  });

  it('restores a valid backup when final is corrupt', async () => {
    const { fileSystem, layout } = setup();
    await seedProject(layout, project('Backup'), '.bak');
    fileSystem.writeText(layout.projectMetadataUri(PROJECT_ID), '{broken');

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();

    expect(report.projects[0]?.project.name).toBe('Backup');
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        { code: 'JSON_BACKUP_RESTORED', uri: layout.projectMetadataUri(PROJECT_ID) },
      ]),
    );
  });

  it('does not promote a temporary project without a proving journal', async () => {
    const { fileSystem, layout } = setup();
    await seedProject(layout, project('Temporary'), '.tmp');

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();

    expect(report.projects).toHaveLength(0);
    expect(report.corruptProjectIds).toContain(PROJECT_ID);
    expect(fileSystem.fileExists(`${layout.projectMetadataUri(PROJECT_ID)}.tmp`)).toBe(true);
  });

  it('promotes a temporary project only when journal, private media and staging state agree', async () => {
    const { fileSystem, layout } = setup();
    const imported = { ...project(), sources: [source()] };
    await seedProject(layout, imported, '.tmp');
    seedFinalSource(fileSystem, layout);
    seedImportJournal(fileSystem, layout);

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();

    expect(report.projects[0]?.project.sources).toHaveLength(1);
    expect(fileSystem.fileExists(layout.projectMetadataUri(PROJECT_ID))).toBe(true);
    expect(report.projects[0]?.repairStatus).toEqual({ state: 'ready', issues: [] });
    expect(fileSystem.fileExists(layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID))).toBe(
      false,
    );
  });

  it('promotes and completes a journal when only project waveform status advanced', async () => {
    const { fileSystem, layout } = setup();
    await seedProject(
      layout,
      {
        ...project(),
        sources: [{ ...source(), waveformStatus: 'processing' }],
      },
      '.tmp',
    );
    seedFinalSource(fileSystem, layout);
    seedImportJournal(fileSystem, layout);

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();

    expect(report.projects[0]?.project.sources[0]?.waveformStatus).toBe('processing');
    expect(report.projects[0]?.repairStatus).toEqual({ state: 'ready', issues: [] });
    expect(fileSystem.fileExists(layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID))).toBe(
      false,
    );
  });

  it('treats project waveform status as dynamic while keeping source metadata strict', async () => {
    const { fileSystem, layout } = setup();
    const processingSource = { ...source(), waveformStatus: 'processing' as const };
    await seedProject(layout, { ...project(), sources: [processingSource] });
    seedFinalSource(fileSystem, layout);

    const recovered = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();
    expect(recovered.projects[0]?.repairStatus).toEqual({ state: 'ready', issues: [] });

    await seedProject(layout, {
      ...project(),
      sources: [{ ...processingSource, sampleRateHz: 48_000 }],
    });
    const mismatched = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();
    expect(mismatched.projects[0]?.repairStatus.issues).toContain('SOURCE_RELATION_MISMATCH');
  });

  it('does not promote temporary metadata when native hash verification is unavailable', async () => {
    const { fileSystem, layout } = setup();
    await seedProject(layout, { ...project(), sources: [source()] }, '.tmp');
    seedFinalSource(fileSystem, layout);
    seedImportJournal(fileSystem, layout);

    const report = await new RecoveryService(layout).recover();

    expect(report.projects).toHaveLength(0);
    expect(report.corruptProjectIds).toContain(PROJECT_ID);
    expect(fileSystem.fileExists(`${layout.projectMetadataUri(PROJECT_ID)}.tmp`)).toBe(true);
  });

  it('does not promote temporary metadata when the actual private-media hash differs', async () => {
    const { fileSystem, layout } = setup();
    await seedProject(layout, { ...project(), sources: [source()] }, '.tmp');
    seedFinalSource(fileSystem, layout);
    seedImportJournal(fileSystem, layout);

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier({ fileSizeBytes: 500, sha256: 'c'.repeat(64) }),
    }).recover();

    expect(report.projects).toHaveLength(0);
    expect(report.corruptProjectIds).toContain(PROJECT_ID);
  });

  it('rolls back an uncommitted journal and orphan source without poisoning the valid project', async () => {
    const { fileSystem, layout } = setup();
    await seedProject(layout, project());
    seedFinalSource(fileSystem, layout);
    seedImportJournal(fileSystem, layout, '2026-08-12T23:01:00.000Z');

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();

    expect(report.projects[0]?.project.sources).toEqual([]);
    expect(report.projects[0]?.repairStatus).toEqual({ state: 'ready', issues: [] });
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID))).toBe(
      false,
    );
    expect(fileSystem.fileExists(layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID))).toBe(
      false,
    );
  });

  it('never follows a mismatched journal into another project directory', async () => {
    const { fileSystem, layout } = setup();
    const otherProjectId = '33333333-3333-4333-8333-333333333333';
    await seedProject(layout, project());
    fileSystem.ensureDirectory(layout.sourceDirectoryUri(otherProjectId, SOURCE_ID));
    fileSystem.writeMedia(layout.sourceAudioUri(otherProjectId, SOURCE_ID, 'source.m4a'), 500);
    fileSystem.writeText(
      layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID),
      JSON.stringify({
        schemaVersion: 1,
        jobId: JOB_ID,
        projectId: otherProjectId,
        sourceId: SOURCE_ID,
        privateAudioFileName: 'source.m4a',
        expectedFileSizeBytes: 500,
        expectedSha256: HASH,
        projectUpdatedAt: NOW,
        nativeInspectionComplete: true,
      }),
    );

    const report = await new RecoveryService(layout, {
      privateMediaVerifier: verifier(),
    }).recover();

    expect(report.projects[0]?.repairStatus.issues).toContain('INCOMPLETE_IMPORT_TRANSACTION');
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(otherProjectId, SOURCE_ID))).toBe(
      true,
    );
  });

  it('rebuilds a corrupt index from authoritative project directories and preserves repairs', async () => {
    const { fileSystem, layout } = setup();
    await seedProject(layout, { ...project(), sources: [source()] });
    fileSystem.writeText(layout.indexUri, '{broken');

    const report = await new RecoveryService(layout).recover();

    const rebuilt = JSON.parse(await fileSystem.readText(layout.indexUri));
    expect(rebuilt.projects).toHaveLength(1);
    expect(rebuilt.projects[0].id).toBe(PROJECT_ID);
    expect(report.projects[0]?.repairStatus.issues).toContain('SOURCE_DIRECTORY_MISSING');
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);
  });

  it('removes only stale inactive staging transactions after 24 hours', async () => {
    const { fileSystem, layout } = setup();
    const activeUri = layout.transactionDirectoryUri('active');
    const staleUri = layout.transactionDirectoryUri('stale');
    fileSystem.ensureDirectory(activeUri);
    fileSystem.ensureDirectory(staleUri);
    fileSystem.now = STALE_TRANSACTION_AGE_MS + 100_000;
    fileSystem.setLastModified(activeUri, 1);
    fileSystem.setLastModified(staleUri, 1);

    const report = await new RecoveryService(layout, {
      now: () => fileSystem.now,
      activeJobIds: () => new Set(['active']),
    }).recover();

    expect(fileSystem.directoryExists(activeUri)).toBe(true);
    expect(fileSystem.directoryExists(staleUri)).toBe(false);
    expect(report.removedTransactionIds).toEqual(['stale']);
  });
});

describe('ProjectRepository', () => {
  it('keeps corrupt project directories discoverable until explicit deletion', async () => {
    const { fileSystem, layout } = setup();
    fileSystem.ensureDirectory(layout.projectDirectoryUri(PROJECT_ID));
    fileSystem.writeText(layout.projectMetadataUri(PROJECT_ID), '{broken');
    const repository = new ProjectRepository({ layout, now: () => NOW });

    await repository.initialize();

    expect(repository.list()).toEqual([]);
    expect(repository.listCorruptProjectIds()).toEqual([PROJECT_ID]);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(true);

    await repository.deleteCorruptProject(PROJECT_ID);

    expect(repository.listCorruptProjectIds()).toEqual([]);
    expect(fileSystem.directoryExists(layout.projectDirectoryUri(PROJECT_ID))).toBe(false);
  });

  it('uses per-project queues while allowing different projects to proceed independently', async () => {
    const { layout } = setup();
    const ids = [PROJECT_ID, '33333333-3333-4333-8333-333333333333'];
    const repository = new ProjectRepository({
      layout,
      now: () => NOW,
      idFactory: () => ids.shift() ?? PROJECT_ID,
    });
    await repository.initialize();

    const [first, second] = await Promise.all([
      repository.create({ name: 'First' }),
      repository.create({ name: 'Second' }),
    ]);
    const [renamedFirst, renamedSecond] = await Promise.all([
      repository.rename(first.id, 'First updated'),
      repository.rename(second.id, 'Second updated'),
    ]);

    expect(renamedFirst.name).toBe('First updated');
    expect(renamedSecond.name).toBe('Second updated');
    expect(repository.list()).toHaveLength(2);
  });

  it('serializes consecutive writes to the same project', async () => {
    const { layout } = setup();
    const repository = new ProjectRepository({
      layout,
      now: () => NOW,
      idFactory: () => PROJECT_ID,
      privateMediaVerifier: verifier(),
    });
    await repository.initialize();
    await repository.create({ name: 'Initial' });

    const first = repository.rename(PROJECT_ID, 'First write');
    const second = repository.rename(PROJECT_ID, 'Second write');
    await Promise.all([first, second]);

    expect(repository.get(PROJECT_ID)?.name).toBe('Second write');
  });

  it('materializes a native staging target and commits only a private relative source', async () => {
    const { fileSystem, layout } = setup();
    const repository = new ProjectRepository({
      layout,
      now: () => NOW,
      idFactory: () => PROJECT_ID,
      privateMediaVerifier: verifier(),
    });
    await repository.initialize();
    await repository.create({ name: 'Import' });
    const paths = repository.beginImport({
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      sourceId: SOURCE_ID,
      privateAudioFileName: 'source.m4a',
    });
    expect(paths.outputFileUri.endsWith('source.m4a.partial')).toBe(true);
    expect(paths.privateAudioRelativePath).toBe(`sources/${SOURCE_ID}/source.m4a`);
    expect(JSON.stringify(paths)).not.toContain('content://');
    fileSystem.writeMedia(paths.outputFileUri, 500);

    const committed = await repository.finalizeImport({
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      targetTrackId: 'track-1',
      source: source(),
      privateAudioSha256: HASH,
    });

    expect(committed.sources).toHaveLength(1);
    expect(committed.clips).toEqual([
      expect.objectContaining({
        id: CLIP_ID,
        sourceId: SOURCE_ID,
        startMs: 0,
        endMs: 1_000,
        trackId: 'track-1',
        timelineStartMs: 0,
        gain: 1,
        fadeInMs: 0,
        fadeOutMs: 0,
      }),
    ]);
    expect(JSON.stringify(committed)).not.toContain('content://');
    expect(fileSystem.fileExists(layout.sourceAudioUri(PROJECT_ID, SOURCE_ID, 'source.m4a'))).toBe(
      true,
    );
    expect(fileSystem.directoryExists(layout.transactionDirectoryUri(JOB_ID))).toBe(false);
  });

  it('commits when directory move completes but the provider reports an error', async () => {
    const { fileSystem, layout } = setup();
    const repository = new ProjectRepository({
      layout,
      now: () => NOW,
      idFactory: () => PROJECT_ID,
      privateMediaVerifier: verifier(),
    });
    await repository.initialize();
    await repository.create({ name: 'Import' });
    const paths = repository.beginImport({
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      sourceId: SOURCE_ID,
      privateAudioFileName: 'source.m4a',
    });
    fileSystem.writeMedia(paths.outputFileUri, 500);
    fileSystem.throwAfterDirectoryMove = true;

    const committed = await repository.finalizeImport({
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      targetTrackId: 'track-1',
      source: source(),
      privateAudioSha256: HASH,
    });

    expect(committed.sources.map(({ id }) => id)).toEqual([SOURCE_ID]);
    expect(fileSystem.fileExists(layout.sourceAudioUri(PROJECT_ID, SOURCE_ID, 'source.m4a'))).toBe(
      true,
    );
  });

  it('fails closed and rolls back when native final-media verification is unavailable', async () => {
    const { fileSystem, layout, repository } = await setupStagedImport();

    await expect(
      repository.finalizeImport({
        jobId: JOB_ID,
        projectId: PROJECT_ID,
        clipId: CLIP_ID,
        targetTrackId: 'track-1',
        source: source(),
        privateAudioSha256: HASH,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_RESULT_INVALID' });

    expect(repository.get(PROJECT_ID)?.sources).toEqual([]);
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID))).toBe(
      false,
    );
    expect(fileSystem.fileExists(layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID))).toBe(
      false,
    );
  });

  it('rolls back a moved source when its actual native hash does not match', async () => {
    const { fileSystem, layout, repository } = await setupStagedImport(
      verifier({ fileSizeBytes: 500, sha256: 'c'.repeat(64) }),
    );

    await expect(
      repository.finalizeImport({
        jobId: JOB_ID,
        projectId: PROJECT_ID,
        clipId: CLIP_ID,
        targetTrackId: 'track-1',
        source: source(),
        privateAudioSha256: HASH,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_RESULT_INVALID' });

    expect(repository.get(PROJECT_ID)?.sources).toEqual([]);
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID))).toBe(
      false,
    );
    expect(fileSystem.fileExists(layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID))).toBe(
      false,
    );
  });

  it('rolls back the journal when the source directory never moves', async () => {
    const { fileSystem, layout, repository } = await setupStagedImport(verifier());
    fileSystem.throwBeforeDirectoryMove = true;

    await expect(
      repository.finalizeImport({
        jobId: JOB_ID,
        projectId: PROJECT_ID,
        clipId: CLIP_ID,
        targetTrackId: 'track-1',
        source: source(),
        privateAudioSha256: HASH,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_RESULT_INVALID' });

    expect(repository.get(PROJECT_ID)?.sources).toEqual([]);
    expect(fileSystem.fileExists(layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID))).toBe(
      false,
    );
    expect(fileSystem.directoryExists(layout.transactionDirectoryUri(JOB_ID))).toBe(false);
  });

  it('rolls back final media when project metadata cannot be written', async () => {
    const { fileSystem, layout, repository } = await setupStagedImport(verifier());
    fileSystem.throwOnWriteUri = `${layout.projectMetadataUri(PROJECT_ID)}.tmp`;

    await expect(
      repository.finalizeImport({
        jobId: JOB_ID,
        projectId: PROJECT_ID,
        clipId: CLIP_ID,
        targetTrackId: 'track-1',
        source: source(),
        privateAudioSha256: HASH,
      }),
    ).rejects.toThrow('Simulated file write failure');

    expect(repository.get(PROJECT_ID)?.sources).toEqual([]);
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID))).toBe(
      false,
    );
    expect(fileSystem.fileExists(layout.projectTransactionJournalUri(PROJECT_ID, JOB_ID))).toBe(
      false,
    );
  });

  it('keeps an officially committed source when cleanup reports a post-commit failure', async () => {
    const { fileSystem, layout, repository } = await setupStagedImport(verifier());
    fileSystem.commitThenThrowOnMoveUri = layout.projectMetadataUri(PROJECT_ID);

    const committed = await repository.finalizeImport({
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      targetTrackId: 'track-1',
      source: source(),
      privateAudioSha256: HASH,
    });

    expect(committed.sources.map(({ id }) => id)).toEqual([SOURCE_ID]);
    expect(fileSystem.directoryExists(layout.sourceDirectoryUri(PROJECT_ID, SOURCE_ID))).toBe(true);
    expect(repository.get(PROJECT_ID)?.sources.map(({ id }) => id)).toEqual([SOURCE_ID]);
  });

  it('cancels staging idempotently and permits the next import without restart', async () => {
    const { layout } = setup();
    const repository = new ProjectRepository({
      layout,
      now: () => NOW,
      idFactory: () => PROJECT_ID,
    });
    await repository.initialize();
    await repository.create({ name: 'Import' });
    repository.beginImport({
      jobId: JOB_ID,
      projectId: PROJECT_ID,
      sourceId: SOURCE_ID,
      privateAudioFileName: 'source.m4a',
    });

    repository.cancelImport(JOB_ID);
    repository.cancelImport(JOB_ID);
    const next = repository.beginImport({
      jobId: 'job-2',
      projectId: PROJECT_ID,
      sourceId: SOURCE_ID,
      privateAudioFileName: 'source.m4a',
    });

    expect(next.jobId).toBe('job-2');
  });
});
