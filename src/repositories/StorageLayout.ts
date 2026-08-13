import { ExpoStorageFileSystem, type StorageFileSystem } from './StorageFileSystem';

export const STORAGE_ROOT_DIRECTORY_NAME = 'SnapCut';
export const PROJECTS_DIRECTORY_NAME = 'projects';
export const STAGING_DIRECTORY_NAME = 'staging';
export const SOURCES_DIRECTORY_NAME = 'sources';

export const INDEX_FILE_NAME = 'index.json';
export const PROJECT_FILE_NAME = 'project.json';
export const SOURCE_METADATA_FILE_NAME = 'source.json';
export const WAVEFORM_FILE_NAME = 'waveform.json';
export const TRANSACTION_DIRECTORY_PREFIX = '.import-';
export const TRANSACTION_JOURNAL_SUFFIX = '.journal.json';

const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_MEDIA_FILE_NAME = /^source\.(?:m4a|m4s|mp3|flac|wav|aac)$/i;

export function assertSafeStorageComponent(value: string, label: string): void {
  if (!SAFE_COMPONENT.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} is not a safe local path component.`);
  }
}

export function assertPrivateAudioFileName(value: string): void {
  if (!SAFE_MEDIA_FILE_NAME.test(value)) {
    throw new Error('Private audio must be a source.* file name, not a path or URI.');
  }
}

function isDirectOrNestedChild(parentUri: string, candidateUri: string): boolean {
  const normalizedParent = parentUri.replace(/\/+$/, '');
  if (!candidateUri.startsWith(`${normalizedParent}/`) || candidateUri.includes('\\')) {
    return false;
  }

  try {
    if (decodeURIComponent(candidateUri) !== candidateUri) {
      return false;
    }
  } catch {
    return false;
  }

  return candidateUri
    .slice(normalizedParent.length + 1)
    .split('/')
    .every((part) => SAFE_COMPONENT.test(part) && part !== '.' && part !== '..');
}

export class StorageLayout {
  constructor(readonly fileSystem: StorageFileSystem = new ExpoStorageFileSystem()) {}

  get rootUri(): string {
    return this.fileSystem.join(this.fileSystem.documentDirectoryUri, STORAGE_ROOT_DIRECTORY_NAME);
  }

  get projectsDirectoryUri(): string {
    return this.fileSystem.join(this.rootUri, PROJECTS_DIRECTORY_NAME);
  }

  get stagingDirectoryUri(): string {
    return this.fileSystem.join(this.rootUri, STAGING_DIRECTORY_NAME);
  }

  get indexUri(): string {
    return this.fileSystem.join(this.rootUri, INDEX_FILE_NAME);
  }

  ensureBaseDirectories(): void {
    this.fileSystem.ensureDirectory(this.rootUri);
    this.fileSystem.ensureDirectory(this.projectsDirectoryUri);
    this.fileSystem.ensureDirectory(this.stagingDirectoryUri);
  }

  projectDirectoryUri(projectId: string): string {
    assertSafeStorageComponent(projectId, 'Project ID');
    return this.fileSystem.join(this.projectsDirectoryUri, projectId);
  }

  projectMetadataUri(projectId: string): string {
    return this.fileSystem.join(this.projectDirectoryUri(projectId), PROJECT_FILE_NAME);
  }

  projectSourcesDirectoryUri(projectId: string): string {
    return this.fileSystem.join(this.projectDirectoryUri(projectId), SOURCES_DIRECTORY_NAME);
  }

  sourceDirectoryUri(projectId: string, sourceId: string): string {
    assertSafeStorageComponent(sourceId, 'Source ID');
    return this.fileSystem.join(this.projectSourcesDirectoryUri(projectId), sourceId);
  }

  sourceMetadataUri(projectId: string, sourceId: string): string {
    return this.fileSystem.join(
      this.sourceDirectoryUri(projectId, sourceId),
      SOURCE_METADATA_FILE_NAME,
    );
  }

  sourceWaveformUri(projectId: string, sourceId: string): string {
    return this.fileSystem.join(this.sourceDirectoryUri(projectId, sourceId), WAVEFORM_FILE_NAME);
  }

  sourceAudioUri(projectId: string, sourceId: string, privateAudioFileName: string): string {
    assertPrivateAudioFileName(privateAudioFileName);
    return this.fileSystem.join(this.sourceDirectoryUri(projectId, sourceId), privateAudioFileName);
  }

  transactionDirectoryUri(jobId: string): string {
    assertSafeStorageComponent(jobId, 'Import job ID');
    return this.fileSystem.join(
      this.stagingDirectoryUri,
      `${TRANSACTION_DIRECTORY_PREFIX}${jobId}`,
    );
  }

  transactionSourceDirectoryUri(jobId: string, sourceId: string): string {
    assertSafeStorageComponent(sourceId, 'Source ID');
    return this.fileSystem.join(
      this.transactionDirectoryUri(jobId),
      SOURCES_DIRECTORY_NAME,
      sourceId,
    );
  }

  transactionAudioUri(jobId: string, sourceId: string, privateAudioFileName: string): string {
    assertPrivateAudioFileName(privateAudioFileName);
    return this.fileSystem.join(
      this.transactionSourceDirectoryUri(jobId, sourceId),
      `${privateAudioFileName}.partial`,
    );
  }

  transactionSourceMetadataUri(jobId: string, sourceId: string): string {
    return this.fileSystem.join(
      this.transactionSourceDirectoryUri(jobId, sourceId),
      SOURCE_METADATA_FILE_NAME,
    );
  }

  transactionWaveformUri(jobId: string, sourceId: string): string {
    return this.fileSystem.join(
      this.transactionSourceDirectoryUri(jobId, sourceId),
      WAVEFORM_FILE_NAME,
    );
  }

  projectTransactionJournalUri(projectId: string, jobId: string): string {
    assertSafeStorageComponent(jobId, 'Import job ID');
    return this.fileSystem.join(
      this.projectDirectoryUri(projectId),
      `${TRANSACTION_DIRECTORY_PREFIX}${jobId}${TRANSACTION_JOURNAL_SUFFIX}`,
    );
  }

  isInsideProjects(uri: string): boolean {
    return isDirectOrNestedChild(this.projectsDirectoryUri, uri);
  }

  isInsideStaging(uri: string): boolean {
    return isDirectOrNestedChild(this.stagingDirectoryUri, uri);
  }

  isTransactionDirectoryUri(uri: string): boolean {
    const prefix = `${this.stagingDirectoryUri.replace(/\/+$/, '')}/`;
    if (!uri.startsWith(prefix) || uri.includes('\\')) return false;
    try {
      if (decodeURIComponent(uri) !== uri) return false;
    } catch {
      return false;
    }
    const name = uri.slice(prefix.length);
    return /^\.import-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
  }
}

export const storageLayout = new StorageLayout();
