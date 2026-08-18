import type { StorageEntry, StorageFileSystem } from '@/repositories/StorageFileSystem';

interface MemoryNode {
  kind: 'file' | 'directory';
  content: string;
  size: number;
  lastModifiedMs: number;
}

function normalized(uri: string): string {
  if (uri === 'file://' || uri === 'file:///') {
    return 'file://';
  }
  return uri.replace(/\/+$/, '');
}

function parentOf(uri: string): string {
  const value = normalized(uri);
  if (value === 'file://') return value;
  const slash = value.lastIndexOf('/');
  return slash < 'file://'.length ? 'file://' : value.slice(0, slash);
}

function nameOf(uri: string): string {
  return normalized(uri).slice(normalized(uri).lastIndexOf('/') + 1);
}

export class MemoryStorageFileSystem implements StorageFileSystem {
  readonly documentDirectoryUri = 'file:///documents';
  readonly nodes = new Map<string, MemoryNode>();
  readonly moves: { source: string; destination: string }[] = [];
  now = 10_000;
  throwBeforeDirectoryMove = false;
  throwAfterDirectoryMove = false;
  throwOnWriteUri: string | null = null;
  throwOnDeleteFileUri: string | null = null;
  commitThenThrowOnMoveUri: string | null = null;

  constructor() {
    this.ensureDirectory(this.documentDirectoryUri);
  }

  join(...parts: readonly string[]): string {
    return parts
      .map((part, index) => (index === 0 ? normalized(part) : part.replace(/^\/+|\/+$/g, '')))
      .join('/');
  }

  ensureDirectory(uri: string): void {
    const value = normalized(uri);
    if (value !== 'file://' && !this.directoryExists(parentOf(value))) {
      this.ensureDirectory(parentOf(value));
    }
    this.nodes.set(value, { kind: 'directory', content: '', size: 0, lastModifiedMs: this.now });
  }

  directoryExists(uri: string): boolean {
    return this.nodes.get(normalized(uri))?.kind === 'directory';
  }

  fileExists(uri: string): boolean {
    return this.nodes.get(normalized(uri))?.kind === 'file';
  }

  fileSize(uri: string): number {
    const node = this.nodes.get(normalized(uri));
    if (node?.kind !== 'file') throw new Error(`Missing file: ${uri}`);
    return node.size;
  }

  listDirectory(uri: string): readonly StorageEntry[] {
    const parent = normalized(uri);
    if (!this.directoryExists(parent)) return [];
    return [...this.nodes.entries()]
      .filter(([candidate]) => candidate !== parent && parentOf(candidate) === parent)
      .map(([candidate, node]) => ({
        uri: candidate,
        name: nameOf(candidate),
        kind: node.kind,
        size: node.kind === 'file' ? node.size : null,
        lastModifiedMs: node.lastModifiedMs,
      }));
  }

  async readText(uri: string): Promise<string> {
    const node = this.nodes.get(normalized(uri));
    if (node?.kind !== 'file') throw new Error(`Missing file: ${uri}`);
    return node.content;
  }

  writeText(uri: string, content: string): void {
    const value = normalized(uri);
    if (this.throwOnWriteUri !== null && value === normalized(this.throwOnWriteUri)) {
      throw new Error('Simulated file write failure.');
    }
    if (!this.directoryExists(parentOf(value))) this.ensureDirectory(parentOf(value));
    this.nodes.set(value, {
      kind: 'file',
      content,
      size: new TextEncoder().encode(content).length,
      lastModifiedMs: this.now,
    });
  }

  writeMedia(uri: string, size: number, lastModifiedMs = this.now): void {
    const value = normalized(uri);
    if (!this.directoryExists(parentOf(value))) this.ensureDirectory(parentOf(value));
    this.nodes.set(value, { kind: 'file', content: '<binary>', size, lastModifiedMs });
  }

  async copyFile(sourceUri: string, destinationUri: string): Promise<void> {
    const node = this.nodes.get(normalized(sourceUri));
    if (node?.kind !== 'file') throw new Error(`Missing source file: ${sourceUri}`);
    if (!this.directoryExists(parentOf(destinationUri)))
      this.ensureDirectory(parentOf(destinationUri));
    this.nodes.set(normalized(destinationUri), { ...node });
  }

  async moveFile(sourceUri: string, destinationUri: string): Promise<void> {
    await this.copyFile(sourceUri, destinationUri);
    this.nodes.delete(normalized(sourceUri));
    this.moves.push({ source: normalized(sourceUri), destination: normalized(destinationUri) });
    if (
      this.commitThenThrowOnMoveUri !== null &&
      normalized(destinationUri) === normalized(this.commitThenThrowOnMoveUri)
    ) {
      throw new Error('Simulated provider error after a completed file move.');
    }
  }

  async moveDirectory(sourceUri: string, destinationUri: string): Promise<void> {
    const source = normalized(sourceUri);
    const destination = normalized(destinationUri);
    if (!this.directoryExists(source) || this.nodes.has(destination)) {
      throw new Error('Directory move target is invalid.');
    }
    if (this.throwBeforeDirectoryMove) {
      throw new Error('Simulated provider error before a directory move.');
    }
    if (!this.directoryExists(parentOf(destination))) this.ensureDirectory(parentOf(destination));
    const entries = [...this.nodes.entries()].filter(
      ([candidate]) => candidate === source || candidate.startsWith(`${source}/`),
    );
    entries.forEach(([candidate, node]) =>
      this.nodes.set(`${destination}${candidate.slice(source.length)}`, { ...node }),
    );
    entries.forEach(([candidate]) => this.nodes.delete(candidate));
    if (this.throwAfterDirectoryMove) {
      throw new Error('Simulated provider error after a completed directory move.');
    }
  }

  deleteFile(uri: string): void {
    if (
      this.throwOnDeleteFileUri !== null &&
      normalized(uri) === normalized(this.throwOnDeleteFileUri)
    ) {
      throw new Error('Simulated file deletion failure.');
    }
    this.nodes.delete(normalized(uri));
  }

  deleteDirectory(uri: string): void {
    const value = normalized(uri);
    [...this.nodes.keys()]
      .filter((candidate) => candidate === value || candidate.startsWith(`${value}/`))
      .forEach((candidate) => this.nodes.delete(candidate));
  }

  setLastModified(uri: string, lastModifiedMs: number): void {
    const node = this.nodes.get(normalized(uri));
    if (!node) throw new Error(`Missing node: ${uri}`);
    node.lastModifiedMs = lastModifiedMs;
  }
}
