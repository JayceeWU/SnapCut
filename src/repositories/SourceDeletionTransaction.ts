import { z } from 'zod';

export const sourceDeletionJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    projectId: z.uuid(),
    sourceId: z.uuid(),
    projectUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type SourceDeletionJournal = z.infer<typeof sourceDeletionJournalSchema>;

export interface SourceDeletionLifecyclePort {
  prepare(projectId: string, sourceId: string): Promise<void>;
}
