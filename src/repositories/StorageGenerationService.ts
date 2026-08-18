import { z } from 'zod';

import { AtomicJsonStore } from './AtomicJsonStore';
import { StorageLayout, storageLayout } from './StorageLayout';

export const CURRENT_STORAGE_GENERATION = 7 as const;

const storageGenerationMarkerSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.literal(CURRENT_STORAGE_GENERATION),
  })
  .strict();

export type StorageGenerationMarker = z.infer<typeof storageGenerationMarkerSchema>;

/**
 * The current private editing store uses this marker as its sole
 * completion point: interrupted cleanup leaves it absent, so next startup
 * safely repeats deletion of only SnapCut-owned project and staging data.
 * diagnostics.json and public MediaStore exports are outside these targets.
 */
export class StorageGenerationService {
  private readonly json: AtomicJsonStore;

  constructor(private readonly layout: StorageLayout = storageLayout) {
    this.json = new AtomicJsonStore(layout.fileSystem);
  }

  async ensureCurrentGeneration(): Promise<boolean> {
    this.layout.fileSystem.ensureDirectory(this.layout.rootUri);
    const marker = await this.json.read(this.layout.storageGenerationUri, (raw) =>
      storageGenerationMarkerSchema.parse(raw),
    );
    if (marker !== null) {
      this.layout.ensureBaseDirectories();
      return false;
    }

    this.deleteDirectoryAndVerify(this.layout.projectsDirectoryUri);
    this.deleteDirectoryAndVerify(this.layout.stagingDirectoryUri);
    for (const uri of [
      this.layout.indexUri,
      `${this.layout.indexUri}.tmp`,
      `${this.layout.indexUri}.bak`,
      this.layout.storageGenerationUri,
      `${this.layout.storageGenerationUri}.tmp`,
      `${this.layout.storageGenerationUri}.bak`,
    ]) {
      this.layout.fileSystem.deleteFile(uri);
      if (this.layout.fileSystem.fileExists(uri)) {
        throw new Error('SnapCut storage cleanup did not remove an app-owned metadata file.');
      }
    }
    this.deleteCorruptIndexFiles();

    this.layout.ensureBaseDirectories();
    await this.json.write(
      this.layout.storageGenerationUri,
      { schemaVersion: 1, generation: CURRENT_STORAGE_GENERATION },
      (raw) => storageGenerationMarkerSchema.parse(raw),
    );
    return true;
  }

  private deleteDirectoryAndVerify(uri: string): void {
    if (this.layout.fileSystem.directoryExists(uri)) {
      this.layout.fileSystem.deleteDirectory(uri);
    }
    if (this.layout.fileSystem.directoryExists(uri)) {
      throw new Error('SnapCut storage cleanup left an app-owned directory behind.');
    }
  }

  private deleteCorruptIndexFiles(): void {
    for (const entry of this.layout.fileSystem.listDirectory(this.layout.rootUri)) {
      if (entry.kind !== 'file' || !/^index\.json\.corrupt-[0-9]+$/u.test(entry.name)) {
        continue;
      }
      this.layout.fileSystem.deleteFile(entry.uri);
      if (this.layout.fileSystem.fileExists(entry.uri)) {
        throw new Error('SnapCut storage cleanup left a corrupt index backup behind.');
      }
    }
  }
}

export const storageGenerationService = new StorageGenerationService();
