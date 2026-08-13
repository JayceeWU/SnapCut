import { Directory, File, Paths } from 'expo-file-system';

export type StorageEntryKind = 'file' | 'directory';

export interface StorageEntry {
  readonly uri: string;
  readonly name: string;
  readonly kind: StorageEntryKind;
  readonly size: number | null;
  readonly lastModifiedMs: number | null;
}

/**
 * Small, injectable boundary around Expo's application-private filesystem.
 * Media bytes never cross this interface; native import jobs write directly to
 * a URI returned by StorageLayout.
 */
export interface StorageFileSystem {
  readonly documentDirectoryUri: string;

  join(...parts: readonly string[]): string;
  ensureDirectory(uri: string): void;
  directoryExists(uri: string): boolean;
  fileExists(uri: string): boolean;
  fileSize(uri: string): number;
  listDirectory(uri: string): readonly StorageEntry[];
  readText(uri: string): Promise<string>;
  writeText(uri: string, content: string): void;
  copyFile(sourceUri: string, destinationUri: string): Promise<void>;
  moveFile(sourceUri: string, destinationUri: string): Promise<void>;
  moveDirectory(sourceUri: string, destinationUri: string): Promise<void>;
  deleteFile(uri: string): void;
  deleteDirectory(uri: string): void;
}

export class ExpoStorageFileSystem implements StorageFileSystem {
  get documentDirectoryUri(): string {
    return Paths.document.uri;
  }

  join(...parts: readonly string[]): string {
    return Paths.join(...parts);
  }

  ensureDirectory(uri: string): void {
    new Directory(uri).create({ idempotent: true, intermediates: true });
  }

  directoryExists(uri: string): boolean {
    const info = Paths.info(uri);
    return info.exists && info.isDirectory === true;
  }

  fileExists(uri: string): boolean {
    const info = Paths.info(uri);
    return info.exists && info.isDirectory === false;
  }

  fileSize(uri: string): number {
    return new File(uri).size;
  }

  listDirectory(uri: string): readonly StorageEntry[] {
    const directory = new Directory(uri);
    if (!directory.exists) {
      return [];
    }

    return directory.list().map((entry): StorageEntry => {
      if (entry instanceof Directory) {
        const info = entry.info();
        return {
          uri: entry.uri,
          name: entry.name,
          kind: 'directory',
          size: info.size ?? null,
          lastModifiedMs: info.modificationTime ?? null,
        };
      }

      return {
        uri: entry.uri,
        name: entry.name,
        kind: 'file',
        size: entry.size,
        lastModifiedMs: entry.lastModified,
      };
    });
  }

  readText(uri: string): Promise<string> {
    return new File(uri).text();
  }

  writeText(uri: string, content: string): void {
    const file = new File(uri);
    file.create({ overwrite: true, intermediates: true });
    file.write(content);
  }

  async copyFile(sourceUri: string, destinationUri: string): Promise<void> {
    await new File(sourceUri).copy(new File(destinationUri), { overwrite: true });
  }

  async moveFile(sourceUri: string, destinationUri: string): Promise<void> {
    await new File(sourceUri).move(new File(destinationUri), { overwrite: true });
  }

  async moveDirectory(sourceUri: string, destinationUri: string): Promise<void> {
    await new Directory(sourceUri).move(new Directory(destinationUri));
  }

  deleteFile(uri: string): void {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  }

  deleteDirectory(uri: string): void {
    const directory = new Directory(uri);
    if (directory.exists) {
      directory.delete();
    }
  }
}
