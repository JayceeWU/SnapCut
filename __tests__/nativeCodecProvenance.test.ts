import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from '@jest/globals';

interface LockedCodecSource {
  name: 'libFLAC' | 'LAME' | 'libsamplerate';
  version: string;
  sourceUrl: string;
  archiveBytes: number;
  sha256: string;
  vendoredFileCount: number;
  vendoredTreeSha256: string;
  license: string;
  vendoredPath: string;
  selection: string;
}

interface NativeSourceLock {
  schemaVersion: 1;
  dependencies: LockedCodecSource[];
}

const THIRD_PARTY_ROOT = path.resolve(
  process.cwd(),
  'modules/snap-cut-media/android/src/main/cpp/third_party',
);

const EXPECTED_PINS = {
  libFLAC: {
    version: '1.5.0',
    archiveBytes: 1_078_872,
    sha256: 'f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920',
    license: 'flac-1.5.0/COPYING.Xiph',
  },
  LAME: {
    version: '4.0',
    archiveBytes: 1_496_810,
    sha256: '3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb',
    license: 'lame-4.0/COPYING',
  },
  libsamplerate: {
    version: '0.2.2',
    archiveBytes: 3_319_468,
    sha256: '3258da280511d24b49d6b08615bbe824d0cacc9842b0e4caf11c52cf2b043893',
    license: 'libsamplerate-0.2.2/COPYING',
  },
} as const;

function listFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  };
  visit(root);
  return files.sort((left, right) => {
    const leftRelative = toPortableRelativePath(root, left);
    const rightRelative = toPortableRelativePath(root, right);
    return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
  });
}

function toPortableRelativePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function fingerprintTree(root: string): { fileCount: number; sha256: string } {
  const files = listFiles(root);
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(toPortableRelativePath(root, file), 'utf8');
    digest.update(Buffer.from([0]));
    digest.update(readFileSync(file));
    digest.update(Buffer.from([0]));
  }
  return { fileCount: files.length, sha256: digest.digest('hex') };
}

function readLock(): NativeSourceLock {
  return JSON.parse(
    readFileSync(path.join(THIRD_PARTY_ROOT, 'SOURCES.lock.json'), 'utf8'),
  ) as NativeSourceLock;
}

describe('pinned native codec source provenance', () => {
  test('locks official archives and the exact extracted source trees', () => {
    const lock = readLock();
    const actualFingerprints: Record<string, { fileCount: number; sha256: string }> = {};
    expect(lock.schemaVersion).toBe(1);
    expect(lock.dependencies.map(({ name }) => name).sort()).toEqual(
      Object.keys(EXPECTED_PINS).sort(),
    );

    for (const dependency of lock.dependencies) {
      const expected = EXPECTED_PINS[dependency.name];
      expect(dependency).toMatchObject({
        version: expected.version,
        archiveBytes: expected.archiveBytes,
        sha256: expected.sha256,
      });
      expect(dependency.sourceUrl).toMatch(/^https:\/\//u);
      expect(existsSync(path.join(THIRD_PARTY_ROOT, expected.license))).toBe(true);

      const fingerprint = fingerprintTree(path.join(THIRD_PARTY_ROOT, dependency.vendoredPath));
      actualFingerprints[dependency.name] = fingerprint;
    }

    expect(actualFingerprints).toEqual(
      Object.fromEntries(
        lock.dependencies.map((dependency) => [
          dependency.name,
          {
            fileCount: dependency.vendoredFileCount,
            sha256: dependency.vendoredTreeSha256,
          },
        ]),
      ),
    );
  });

  test('contains no prebuilt native artifacts or LAME decoder and CLI sources', () => {
    const forbiddenExtensions = new Set(['.so', '.a', '.o', '.aar', '.dll', '.lib', '.exe']);
    const prebuilt = listFiles(THIRD_PARTY_ROOT).filter((file) =>
      forbiddenExtensions.has(path.extname(file).toLowerCase()),
    );
    expect(prebuilt).toEqual([]);

    const lameRoot = path.join(THIRD_PARTY_ROOT, 'lame-4.0');
    expect(existsSync(path.join(lameRoot, 'mpglib'))).toBe(false);
    expect(existsSync(path.join(lameRoot, 'frontend'))).toBe(false);
    expect(existsSync(path.join(lameRoot, 'libmp3lame/mpglib_interface.c'))).toBe(false);
  });

  test('pins the Android native build to two supported ABIs and source-built shared LAME', () => {
    const moduleRoot = path.resolve(process.cwd(), 'modules/snap-cut-media/android');
    const gradle = readFileSync(path.join(moduleRoot, 'build.gradle'), 'utf8');
    const cmake = readFileSync(path.join(moduleRoot, 'src/main/cpp/CMakeLists.txt'), 'utf8');

    expect(gradle).toContain("abiFilters 'arm64-v8a', 'x86_64'");
    expect(cmake).toContain('add_library(mp3lame SHARED ${SNAPCUT_LAME_SOURCES})');
    expect(cmake).toMatch(
      /add_library\(snapcut_codec SHARED[\s\S]*snapcut_codec_jni\.cpp[\s\S]*export_codec_jni\.cpp[\s\S]*\)/u,
    );
  });
});
