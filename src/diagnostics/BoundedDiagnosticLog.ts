import { Directory, File, Paths } from 'expo-file-system';
import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { z } from 'zod';

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticFields {
  operation?: 'repository' | 'import' | 'waveform' | 'preview' | 'preflight' | 'export';
  stage?: string;
  code?: string;
  status?: string;
  generation?: number;
  elapsedMs?: number;
  sourceBytes?: number;
  outputBytes?: number;
  available?: boolean;
  version?: string;
  projectId?: string;
  sourceId?: string;
  jobId?: string;
  appVersion?: string;
  androidVersion?: string | number;
  nativeStage?: string;
  causeCategory?: string;
  contractFields?: string;
  repairIssues?: string;
}

export interface DiagnosticEntry {
  timestamp: string;
  level: DiagnosticLevel;
  event: string;
  fields: DiagnosticFields;
}

const MAX_ENTRIES = 200;
const SAFE_FIELD_KEYS = new Set<keyof DiagnosticFields>([
  'operation',
  'stage',
  'code',
  'status',
  'generation',
  'elapsedMs',
  'sourceBytes',
  'outputBytes',
  'available',
  'version',
  'projectId',
  'sourceId',
  'jobId',
  'appVersion',
  'androidVersion',
  'nativeStage',
  'causeCategory',
  'contractFields',
  'repairIssues',
]);
const SAFE_VALUE = z.union([z.string().max(80), z.number().finite(), z.boolean()]);
const diagnosticEntrySchema = z
  .object({
    timestamp: z.iso.datetime({ offset: true }),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    event: z.string().regex(/^[a-z0-9_.-]{1,80}$/u),
    fields: z.record(z.string(), SAFE_VALUE).refine((value) => Object.keys(value).length <= 12),
  })
  .strict();
const diagnosticFileSchema = z
  .object({ schemaVersion: z.literal(1), entries: z.array(diagnosticEntrySchema).max(MAX_ENTRIES) })
  .strict();

export class BoundedDiagnosticLog {
  private readonly directory = new Directory(Paths.document, 'SnapCut');
  private readonly file = new File(this.directory, 'diagnostics.json');
  private entries: DiagnosticEntry[] = [];
  private loaded = false;
  private writes: Promise<void> = Promise.resolve();

  async initialize(): Promise<void> {
    if (this.loaded) return;
    this.directory.create({ idempotent: true, intermediates: true });
    if (this.file.exists) {
      try {
        const parsed = diagnosticFileSchema.parse(JSON.parse(await this.file.text()));
        this.entries = parsed.entries as DiagnosticEntry[];
      } catch {
        this.entries = [];
      }
    }
    this.loaded = true;
  }

  async append(
    level: DiagnosticLevel,
    event: string,
    fields: DiagnosticFields = {},
  ): Promise<void> {
    await this.initialize();
    const safeFields = sanitizeDiagnosticFields({
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      androidVersion: Platform.Version,
      ...fields,
    });
    const entry = diagnosticEntrySchema.parse({
      timestamp: new Date().toISOString(),
      level,
      event,
      fields: safeFields,
    }) as DiagnosticEntry;
    this.entries = [...this.entries, entry].slice(-MAX_ENTRIES);
    this.writes = this.writes.then(() => {
      this.file.write(JSON.stringify({ schemaVersion: 1, entries: this.entries }));
    });
    await this.writes;
  }

  async list(): Promise<DiagnosticEntry[]> {
    await this.initialize();
    return this.entries.map((entry) => ({ ...entry, fields: { ...entry.fields } }));
  }

  async clear(): Promise<void> {
    await this.initialize();
    this.entries = [];
    this.file.write(JSON.stringify({ schemaVersion: 1, entries: [] }));
  }

  async share(): Promise<void> {
    await this.initialize();
    if (!(await Sharing.isAvailableAsync())) throw new Error('Android sharing is unavailable.');
    await Sharing.shareAsync(this.file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Share SnapCut diagnostics',
    });
  }
}

/** Runtime allowlist: callers cannot smuggle URI, path, or display-name fields into the log. */
export function sanitizeDiagnosticFields(fields: DiagnosticFields): DiagnosticFields {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [keyof DiagnosticFields, string | number | boolean] => {
        const [key, value] = entry;
        return (
          SAFE_FIELD_KEYS.has(key as keyof DiagnosticFields) &&
          value !== undefined &&
          SAFE_VALUE.safeParse(value).success
        );
      },
    ),
  );
}

export const diagnosticLog = new BoundedDiagnosticLog();
