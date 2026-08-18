import { z } from 'zod';

import type { SnapCutSource } from '@/domain/types';

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const importTransactionJournalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
  privateAudioFileName: z.string().regex(/^source\.(?:m4a|m4s|mp3|flac|wav|aac)$/i),
  expectedFileSizeBytes: z.number().int().positive(),
  expectedSha256: z.string().regex(SHA256_PATTERN),
  projectUpdatedAt: z.string().datetime({ offset: true }),
  nativeInspectionComplete: z.literal(true),
});

export type ImportTransactionJournal = z.infer<typeof importTransactionJournalSchema>;

/**
 * Actual facts computed by the native layer from an app-private media file.
 * JavaScript must never open or hash media bytes itself.
 */
export interface PrivateMediaVerification {
  readonly fileSizeBytes: number;
  readonly sha256: string;
}

/**
 * Injected native boundary used immediately before an import becomes visible
 * and when recovery needs cryptographic proof for a pending transaction.
 */
export interface PrivateMediaVerifier {
  verifyPrivateMedia(fileUri: string): Promise<PrivateMediaVerification>;
}

export interface BeginImportInput {
  readonly jobId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly privateAudioFileName: string;
}

export interface ImportTransactionPaths {
  readonly jobId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly stagingDirectoryUri: string;
  readonly outputFileUri: string;
  readonly privateAudioRelativePath: string;
}

export interface FinalizeImportInput {
  readonly jobId: string;
  readonly projectId: string;
  readonly source: SnapCutSource;
  /** SHA-256 returned by native inspection for the completed private media. */
  readonly privateAudioSha256: string;
}
