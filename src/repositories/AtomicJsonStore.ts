import type { StorageFileSystem } from './StorageFileSystem';

type JsonParser<T> = (input: unknown) => T;

export interface AtomicJsonWriteOptions {
  /** Cache files may replace invalid committed JSON after preserving it. */
  readonly preserveInvalidCommitted?: boolean;
}

export class AtomicJsonStore {
  constructor(private readonly fileSystem: StorageFileSystem) {}

  async read<T>(uri: string, parse: JsonParser<T>): Promise<T | null> {
    if (!this.fileSystem.fileExists(uri)) {
      return null;
    }

    try {
      return parse(JSON.parse(await this.fileSystem.readText(uri)) as unknown);
    } catch {
      return null;
    }
  }

  async write<T>(
    destinationUri: string,
    value: T,
    parse: JsonParser<T>,
    options: AtomicJsonWriteOptions = {},
  ): Promise<T> {
    const validated = parse(value);
    const temporaryUri = `${destinationUri}.tmp`;
    const backupUri = `${destinationUri}.bak`;

    this.fileSystem.writeText(temporaryUri, JSON.stringify(validated));
    const verifiedTemporary = await this.read(temporaryUri, parse);
    if (verifiedTemporary === null) {
      throw new Error(`Temporary JSON verification failed for ${destinationUri}.`);
    }

    if (this.fileSystem.fileExists(destinationUri)) {
      if ((await this.read(destinationUri, parse)) === null) {
        if (options.preserveInvalidCommitted !== true) {
          throw new Error(`Refusing to replace invalid committed JSON at ${destinationUri}.`);
        }
        await this.fileSystem.moveFile(destinationUri, `${destinationUri}.corrupt-${Date.now()}`);
      }
      if (this.fileSystem.fileExists(destinationUri)) {
        if (this.fileSystem.fileExists(backupUri)) {
          this.fileSystem.deleteFile(backupUri);
        }
        await this.fileSystem.moveFile(destinationUri, backupUri);
      }
    }

    try {
      await this.fileSystem.moveFile(temporaryUri, destinationUri);
    } catch (error) {
      if ((await this.read(destinationUri, parse)) === null) {
        await this.restoreBackup(destinationUri, backupUri, parse);
        throw error;
      }
    }

    const committed = await this.read(destinationUri, parse);
    if (committed === null) {
      await this.restoreBackup(destinationUri, backupUri, parse);
      throw new Error(`Committed JSON verification failed for ${destinationUri}.`);
    }

    if (this.fileSystem.fileExists(backupUri)) {
      this.fileSystem.deleteFile(backupUri);
    }
    return committed;
  }

  private async restoreBackup<T>(
    destinationUri: string,
    backupUri: string,
    parse: JsonParser<T>,
  ): Promise<void> {
    if ((await this.read(backupUri, parse)) === null) {
      return;
    }
    try {
      await this.fileSystem.copyFile(backupUri, destinationUri);
    } catch {
      // Recovery will retry from the still-valid backup on the next launch.
    }
  }
}
