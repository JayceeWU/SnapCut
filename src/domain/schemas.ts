import { z } from 'zod';

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  MAX_PROJECT_NAME_CODE_POINTS,
  PROJECT_INDEX_SCHEMA_VERSION,
  SOURCE_FILE_SCHEMA_VERSION,
  WAVEFORM_BIN_COUNT,
  WAVEFORM_SCHEMA_VERSION,
} from './constants';
import { isValidProjectName } from './naming';

export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const nonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, 'Value must be a safe integer');

export const positiveIntegerSchema = nonNegativeIntegerSchema.refine(
  (value) => value > 0,
  'Value must be greater than zero',
);

export const integerMillisecondsSchema = nonNegativeIntegerSchema;
export const positiveIntegerMillisecondsSchema = positiveIntegerSchema;

export const projectNameSchema = z.string().superRefine((value, context) => {
  if (!isValidProjectName(value)) {
    context.addIssue({
      code: 'custom',
      message: `Project name must be trimmed and contain 1 to ${MAX_PROJECT_NAME_CODE_POINTS} Unicode characters`,
    });
  }
});

const nonEmptyStringSchema = z.string().trim().min(1);
const nullableNonEmptyStringSchema = nonEmptyStringSchema.nullable();
const localFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim(), 'File name must be trimmed')
  .refine(
    (value) => !value.includes('/') && !value.includes('\\'),
    'Path separators are not allowed',
  )
  .refine((value) => value !== '.' && value !== '..', 'Relative path components are not allowed')
  .refine((value) => !value.includes('\0'), 'NUL is not allowed')
  .refine((value) => !/^[a-z][a-z0-9+.-]*:/iu.test(value), 'URIs are not allowed');

export const sourceKindSchema = z.enum([
  'video-extracted-aac',
  'm4a',
  'm4s-aac',
  'mp3',
  'flac',
  'wav',
]);

export const aacProfileSchema = z.enum(['aac-lc', 'he-aac-v1', 'he-aac-v2']).nullable();
export const waveformStatusSchema = z.enum(['pending', 'processing', 'ready', 'failed']);
export const channelCountSchema = z.union([z.literal(1), z.literal(2)]);
export const pcmBitsPerSampleSchema = z
  .union([z.literal(8), z.literal(16), z.literal(24), z.literal(32)])
  .nullable();

const snapCutSourceV1Shape = {
  id: uuidSchema,
  displayName: nonEmptyStringSchema.max(255),
  originalMimeType: nullableNonEmptyStringSchema,
  sourceKind: sourceKindSchema,
  privateAudioFileName: localFileNameSchema,
  durationMs: positiveIntegerMillisecondsSchema,
  codecMime: z.string().regex(/^audio\/[a-z0-9!#$&^_.+-]+$/iu),
  sampleRateHz: positiveIntegerSchema,
  channelCount: channelCountSchema,
  encodedBitrateBps: positiveIntegerSchema.nullable(),
  pcmBitsPerSample: pcmBitsPerSampleSchema,
  fileSizeBytes: positiveIntegerSchema,
  waveformFileName: localFileNameSchema,
  waveformStatus: waveformStatusSchema,
  createdAt: isoDateTimeSchema,
};

export const snapCutSourceV1Schema = z.object(snapCutSourceV1Shape).strict();

export const snapCutSourceSchema = z
  .object({
    ...snapCutSourceV1Shape,
    aacProfile: aacProfileSchema,
    codecConfigFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    encoderDelayFrames: nonNegativeIntegerSchema.nullable(),
    encoderPaddingFrames: nonNegativeIntegerSchema.nullable(),
    privateAudioSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
  })
  .strict()
  .superRefine((source, context) => {
    if (
      (source.sourceKind === 'mp3' ||
        source.sourceKind === 'flac' ||
        source.sourceKind === 'wav') &&
      (source.aacProfile !== null || source.codecConfigFingerprint !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['codecConfigFingerprint'],
        message: 'Non-AAC sources cannot persist AAC profile or codec configuration metadata',
      });
    }
  });

export const snapCutClipSchema = z
  .object({
    id: uuidSchema,
    sourceId: uuidSchema,
    startMs: integerMillisecondsSchema,
    endMs: positiveIntegerMillisecondsSchema,
  })
  .strict()
  .superRefine((clip, context) => {
    if (clip.startMs >= clip.endMs) {
      context.addIssue({
        code: 'custom',
        path: ['endMs'],
        message: 'Clip end must be after clip start',
      });
    }
  });

export const snapCutExportFormatSchema = z.enum(['m4a', 'flac', 'mp3']);
export const snapCutExportModeSchema = z.enum([
  'aac-stream-copy',
  'flac-lossless-encode',
  'mp3-lossy-encode',
]);

export const snapCutExportRecordSchema = z
  .object({
    format: snapCutExportFormatSchema,
    mode: snapCutExportModeSchema,
    displayName: nonEmptyStringSchema.max(255),
    contentUri: z.string().regex(/^content:\/\/[^\s]+$/u),
    exportedAt: isoDateTimeSchema,
    requestedDurationMs: positiveIntegerMillisecondsSchema,
    actualDurationMs: positiveIntegerMillisecondsSchema,
    sampleRateHz: positiveIntegerSchema,
    channelCount: channelCountSchema,
    bitrateKbps: z.literal(320).nullable(),
    bitsPerSample: z.literal(24).nullable(),
    maxBoundaryAdjustmentMs: integerMillisecondsSchema,
    fileSizeBytes: positiveIntegerSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const expectedMode = {
      m4a: 'aac-stream-copy',
      flac: 'flac-lossless-encode',
      mp3: 'mp3-lossy-encode',
    }[record.format];

    if (record.mode !== expectedMode) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'Export mode does not match format',
      });
    }

    if (record.format === 'm4a' && (record.bitrateKbps !== null || record.bitsPerSample !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'M4A stream-copy records cannot claim an encoder bitrate or PCM bit depth',
      });
    }

    if (record.format === 'flac' && (record.bitrateKbps !== null || record.bitsPerSample !== 24)) {
      context.addIssue({
        code: 'custom',
        message: 'FLAC records require 24-bit output and no MP3 bitrate',
      });
    }

    if (record.format === 'mp3' && (record.bitrateKbps !== 320 || record.bitsPerSample !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'MP3 records require 320 kbps and no FLAC bit depth',
      });
    }

    if (record.format !== 'm4a' && record.maxBoundaryAdjustmentMs !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['maxBoundaryAdjustmentMs'],
        message: 'Only M4A stream-copy may report boundary adjustments',
      });
    }
  });

interface ProjectRelationShape {
  createdAt: string;
  updatedAt: string;
  sources: { id: string; durationMs: number }[];
  clips: { id: string; sourceId: string; startMs: number; endMs: number }[];
}

function refineProjectRelations(project: ProjectRelationShape, context: z.RefinementCtx): void {
  if (Date.parse(project.updatedAt) < Date.parse(project.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'Project update time cannot precede creation time',
    });
  }

  const sourceIds = new Set<string>();
  for (const [index, source] of project.sources.entries()) {
    if (sourceIds.has(source.id)) {
      context.addIssue({
        code: 'custom',
        path: ['sources', index, 'id'],
        message: 'Source IDs must be unique',
      });
    }
    sourceIds.add(source.id);
  }

  const sourcesById = new Map(project.sources.map((source) => [source.id, source]));
  const clipIds = new Set<string>();
  for (const [index, clip] of project.clips.entries()) {
    if (clipIds.has(clip.id)) {
      context.addIssue({
        code: 'custom',
        path: ['clips', index, 'id'],
        message: 'Clip IDs must be unique',
      });
    }
    clipIds.add(clip.id);

    const source = sourcesById.get(clip.sourceId);
    if (!source) {
      context.addIssue({
        code: 'custom',
        path: ['clips', index, 'sourceId'],
        message: 'Clip must reference a source in the same project',
      });
      continue;
    }

    if (clip.endMs > source.durationMs) {
      context.addIssue({
        code: 'custom',
        path: ['clips', index, 'endMs'],
        message: 'Clip end cannot exceed source duration',
      });
    }

    if (clip.endMs - clip.startMs < 100) {
      context.addIssue({
        code: 'custom',
        path: ['clips', index, 'endMs'],
        message: 'Clip duration must be at least 100 milliseconds',
      });
    }
  }
}

const projectCommonShape = {
  id: uuidSchema,
  name: projectNameSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  clips: z.array(snapCutClipSchema),
  lastExport: snapCutExportRecordSchema.nullable(),
};

export const snapCutProjectV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ...projectCommonShape,
    sources: z.array(snapCutSourceV1Schema),
  })
  .strict()
  .superRefine(refineProjectRelations);

export const snapCutProjectV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...projectCommonShape,
    sources: z.array(snapCutSourceSchema),
  })
  .strict()
  .superRefine(refineProjectRelations);

export const snapCutProjectSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_PROJECT_SCHEMA_VERSION),
    ...projectCommonShape,
    namePromptCompleted: z.boolean(),
    sources: z.array(snapCutSourceSchema),
  })
  .strict()
  .superRefine(refineProjectRelations);

export const sourceFileV1Schema = z
  .object({
    schemaVersion: z.literal(SOURCE_FILE_SCHEMA_VERSION),
    projectId: uuidSchema,
    source: snapCutSourceSchema,
  })
  .strict();
export const sourceFileSchema = sourceFileV1Schema;

const waveformValueSchema = z.number().finite().min(0).max(1);
export const waveformFileV1Schema = z
  .object({
    schemaVersion: z.literal(WAVEFORM_SCHEMA_VERSION),
    durationMs: positiveIntegerMillisecondsSchema,
    binCount: z.literal(WAVEFORM_BIN_COUNT),
    rms: z.array(waveformValueSchema).length(WAVEFORM_BIN_COUNT),
    peak: z.array(waveformValueSchema).length(WAVEFORM_BIN_COUNT),
  })
  .strict();
export const waveformFileSchema = waveformFileV1Schema;

export const projectIndexEntrySchema = z
  .object({
    id: uuidSchema,
    name: projectNameSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    sourceCount: nonNegativeIntegerSchema,
    clipCount: nonNegativeIntegerSchema,
    compositionDurationMs: integerMillisecondsSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (Date.parse(entry.updatedAt) < Date.parse(entry.createdAt)) {
      context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Invalid project dates' });
    }
  });

export const projectIndexFileV1Schema = z
  .object({
    schemaVersion: z.literal(PROJECT_INDEX_SCHEMA_VERSION),
    projects: z.array(projectIndexEntrySchema),
  })
  .strict()
  .superRefine((index, context) => {
    const ids = new Set<string>();
    for (const [position, project] of index.projects.entries()) {
      if (ids.has(project.id)) {
        context.addIssue({
          code: 'custom',
          path: ['projects', position, 'id'],
          message: 'Project index IDs must be unique',
        });
      }
      ids.add(project.id);
    }
  });

export const projectIndexSchema = projectIndexFileV1Schema;

export const m4aPlannedClipSchema = z
  .object({
    clipId: uuidSchema,
    sourceId: uuidSchema,
    requestedStartMs: integerMillisecondsSchema,
    requestedEndMs: positiveIntegerMillisecondsSchema,
    effectiveStartUs: nonNegativeIntegerSchema,
    effectiveEndUs: positiveIntegerSchema,
    startAdjustmentMs: z.number().int().refine(Number.isSafeInteger),
    endAdjustmentMs: z.number().int().refine(Number.isSafeInteger),
    estimatedEncodedBytes: positiveIntegerSchema,
  })
  .strict()
  .superRefine((clip, context) => {
    if (clip.requestedEndMs - clip.requestedStartMs < 100) {
      context.addIssue({
        code: 'custom',
        path: ['requestedEndMs'],
        message: 'Requested M4A clip range must be at least 100 milliseconds',
      });
    }
    if (clip.effectiveStartUs >= clip.effectiveEndUs) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveEndUs'],
        message: 'Invalid effective range',
      });
    }
  });

export const m4aSourceSnapshotSchema = z
  .object({
    sourceId: uuidSchema,
    privateAudioSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    codecConfigFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    fileSizeBytes: positiveIntegerSchema,
    lastModifiedEpochMs: nonNegativeIntegerSchema,
  })
  .strict();

export const m4aExportPlanSchema = z
  .object({
    planVersion: z.literal(1),
    planId: uuidSchema,
    createdAt: isoDateTimeSchema,
    eligible: z.boolean(),
    reasons: z.array(nonEmptyStringSchema),
    codecConfigFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    sampleRateHz: positiveIntegerSchema.nullable(),
    channelCount: channelCountSchema.nullable(),
    maxBoundaryAdjustmentMs: integerMillisecondsSchema,
    estimatedOutputBytes: positiveIntegerSchema.nullable(),
    sourceSnapshots: z.array(m4aSourceSnapshotSchema),
    clips: z.array(m4aPlannedClipSchema),
  })
  .strict()
  .superRefine((plan, context) => {
    const snapshotIds = new Set<string>();
    for (const [index, snapshot] of plan.sourceSnapshots.entries()) {
      if (snapshotIds.has(snapshot.sourceId)) {
        context.addIssue({
          code: 'custom',
          path: ['sourceSnapshots', index, 'sourceId'],
          message: 'M4A source snapshots must be unique',
        });
      }
      snapshotIds.add(snapshot.sourceId);
    }

    const clipIds = new Set<string>();
    for (const [index, clip] of plan.clips.entries()) {
      if (clipIds.has(clip.clipId)) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'clipId'],
          message: 'M4A planned clip IDs must be unique',
        });
      }
      clipIds.add(clip.clipId);
    }

    if (plan.eligible) {
      if (plan.reasons.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['reasons'],
          message: 'Eligible plan cannot have reasons',
        });
      }
      if (
        plan.codecConfigFingerprint === null ||
        plan.sampleRateHz === null ||
        plan.channelCount === null ||
        plan.estimatedOutputBytes === null ||
        plan.sourceSnapshots.length === 0 ||
        plan.clips.length === 0
      ) {
        context.addIssue({ code: 'custom', message: 'Eligible M4A plan is incomplete' });
      }
      for (const [index, clip] of plan.clips.entries()) {
        const snapshot = plan.sourceSnapshots.find(({ sourceId }) => sourceId === clip.sourceId);
        if (!snapshot || snapshot.codecConfigFingerprint !== plan.codecConfigFingerprint) {
          context.addIssue({
            code: 'custom',
            path: ['clips', index, 'sourceId'],
            message: 'Eligible clip must reference a matching immutable source snapshot',
          });
        }
        if (Math.abs(clip.startAdjustmentMs) > 20 || Math.abs(clip.endAdjustmentMs) > 20) {
          context.addIssue({
            code: 'custom',
            path: ['clips', index],
            message: 'Eligible M4A boundary adjustment cannot exceed 20 milliseconds',
          });
        }
      }
      for (const [index, snapshot] of plan.sourceSnapshots.entries()) {
        if (!plan.clips.some(({ sourceId }) => sourceId === snapshot.sourceId)) {
          context.addIssue({
            code: 'custom',
            path: ['sourceSnapshots', index, 'sourceId'],
            message: 'Eligible M4A plan cannot contain an unused source snapshot',
          });
        }
      }
      const computedMaximum = plan.clips.reduce(
        (maximum, clip) =>
          Math.max(maximum, Math.abs(clip.startAdjustmentMs), Math.abs(clip.endAdjustmentMs)),
        0,
      );
      if (plan.maxBoundaryAdjustmentMs !== computedMaximum) {
        context.addIssue({
          code: 'custom',
          path: ['maxBoundaryAdjustmentMs'],
          message: 'M4A maximum adjustment must match the planned clip boundaries',
        });
      }
      const plannedPayloadBytes = plan.clips.reduce(
        (total, clip) => total + clip.estimatedEncodedBytes,
        0,
      );
      if (plan.estimatedOutputBytes !== null && plan.estimatedOutputBytes < plannedPayloadBytes) {
        context.addIssue({
          code: 'custom',
          path: ['estimatedOutputBytes'],
          message: 'M4A output estimate cannot be smaller than its encoded payload estimate',
        });
      }
    } else if (plan.reasons.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['reasons'],
        message: 'Ineligible M4A plan must explain why it is unavailable',
      });
    }
  });

export const exportFormatAvailabilitySchema = z
  .object({
    format: snapCutExportFormatSchema,
    available: z.boolean(),
    reasons: z.array(nonEmptyStringSchema),
    estimatedOutputBytes: positiveIntegerSchema.nullable(),
    requiredFreeBytes: positiveIntegerSchema.nullable(),
    sampleRateHz: positiveIntegerSchema.nullable(),
    channelCount: channelCountSchema.nullable(),
  })
  .strict()
  .superRefine((availability, context) => {
    if (availability.available && availability.reasons.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['reasons'],
        message: 'Available format cannot have reasons',
      });
    }
    if (!availability.available && availability.reasons.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['reasons'],
        message: 'Unavailable format needs a reason',
      });
    }
  });

export const exportPreflightResultSchema = z
  .object({
    preferredFormat: z.enum(['m4a', 'flac']),
    m4aPlan: m4aExportPlanSchema,
    formats: z.array(exportFormatAvailabilitySchema).length(3),
  })
  .strict()
  .superRefine((result, context) => {
    const formats = new Set(result.formats.map(({ format }) => format));
    if (formats.size !== 3) {
      context.addIssue({
        code: 'custom',
        path: ['formats'],
        message: 'Preflight must include each format once',
      });
    }
    const expected = result.m4aPlan.eligible ? 'm4a' : 'flac';
    if (result.preferredFormat !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['preferredFormat'],
        message: 'Preferred format must follow M4A eligibility',
      });
    }
  });
