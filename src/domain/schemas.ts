import { z } from 'zod';

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  CROSSFADE_DURATION_VALUES_MS,
  FADE_DURATION_STEP_MS,
  MAX_FADE_DURATION_MS,
  MAX_PROJECT_NAME_CODE_POINTS,
  MAX_SOURCE_NAME_CODE_POINTS,
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
export const sourceDisplayNameSchema = z
  .string()
  .refine((value) => value === value.trim(), 'Source name must be trimmed')
  .refine(
    (value) => [...value].length >= 1 && [...value].length <= MAX_SOURCE_NAME_CODE_POINTS,
    `Source name must contain 1 to ${MAX_SOURCE_NAME_CODE_POINTS} Unicode characters`,
  );
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
export const fadeDurationMsSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_FADE_DURATION_MS)
  .refine(Number.isSafeInteger, 'Fade duration must be a safe integer')
  .refine(
    (value) => value % FADE_DURATION_STEP_MS === 0,
    `Fade duration must use ${FADE_DURATION_STEP_MS} millisecond steps`,
  );
export const channelCountSchema = z.union([z.literal(1), z.literal(2)]);
export const pcmBitsPerSampleSchema = z
  .union([z.literal(8), z.literal(16), z.literal(24), z.literal(32)])
  .nullable();

const snapCutSourceShape = {
  id: uuidSchema,
  displayName: sourceDisplayNameSchema,
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
};

function refineSourceCodecMetadata(
  source: {
    sourceKind: z.infer<typeof sourceKindSchema>;
    aacProfile: z.infer<typeof aacProfileSchema>;
    codecConfigFingerprint: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (
    (source.sourceKind === 'mp3' || source.sourceKind === 'flac' || source.sourceKind === 'wav') &&
    (source.aacProfile !== null || source.codecConfigFingerprint !== null)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['codecConfigFingerprint'],
      message: 'Non-AAC sources cannot persist AAC profile or codec configuration metadata',
    });
  }
}

export const snapCutSourceSchema = z
  .object(snapCutSourceShape)
  .strict()
  .superRefine(refineSourceCodecMetadata);

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

export const sourceComparisonBookmarkSchema = z
  .object({
    sourceId: uuidSchema,
    firstMs: positiveIntegerMillisecondsSchema,
    secondMs: positiveIntegerMillisecondsSchema,
  })
  .strict()
  .superRefine((bookmark, context) => {
    if (bookmark.firstMs >= bookmark.secondMs) {
      context.addIssue({
        code: 'custom',
        path: ['secondMs'],
        message: 'The second comparison point must be later than the first',
      });
    }
  });

export const crossfadeDurationMsSchema = z.union(
  CROSSFADE_DURATION_VALUES_MS.map((value) => z.literal(value)) as [
    z.ZodLiteral<1000>,
    z.ZodLiteral<2000>,
    z.ZodLiteral<4000>,
    z.ZodLiteral<6000>,
    z.ZodLiteral<8000>,
  ],
);

export const snapCutCrossfadeSchema = z
  .object({
    id: uuidSchema,
    leftClipId: uuidSchema,
    rightClipId: uuidSchema,
    durationMs: crossfadeDurationMsSchema,
  })
  .strict();

export const snapCutExportFormatSchema = z.enum(['m4a', 'mp3']);
export const snapCutExportModeSchema = z.enum([
  'aac-stream-copy',
  'aac-lossy-encode',
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
    bitrateKbps: z.union([z.literal(160), z.literal(320)]).nullable(),
    maxBoundaryAdjustmentMs: integerMillisecondsSchema,
    fileSizeBytes: positiveIntegerSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const modeMatchesFormat =
      (record.format === 'm4a' &&
        (record.mode === 'aac-stream-copy' || record.mode === 'aac-lossy-encode')) ||
      (record.format === 'mp3' && record.mode === 'mp3-lossy-encode');

    if (!modeMatchesFormat) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'Export mode does not match format',
      });
    }

    if (record.mode === 'aac-stream-copy' && record.bitrateKbps !== null) {
      context.addIssue({
        code: 'custom',
        message: 'M4A stream-copy records cannot claim an encoder bitrate or PCM bit depth',
      });
    }

    if (
      record.mode === 'aac-lossy-encode' &&
      record.bitrateKbps !== (record.channelCount === 1 ? 160 : 320)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Re-encoded AAC records require the fixed channel-specific bitrate',
      });
    }

    if (record.format === 'mp3' && record.bitrateKbps !== 320) {
      context.addIssue({
        code: 'custom',
        message: 'MP3 records require 320 kbps and no PCM bit depth',
      });
    }

    if (record.mode !== 'aac-stream-copy' && record.maxBoundaryAdjustmentMs !== 0) {
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
  clips: {
    id: string;
    sourceId: string;
    startMs: number;
    endMs: number;
  }[];
  sourceComparisons: { sourceId: string; firstMs: number; secondMs: number }[];
  crossfades: {
    id: string;
    leftClipId: string;
    rightClipId: string;
    durationMs: number;
  }[];
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

  const comparisonSourceIds = new Set<string>();
  for (const [index, bookmark] of project.sourceComparisons.entries()) {
    if (comparisonSourceIds.has(bookmark.sourceId)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceComparisons', index, 'sourceId'],
        message: 'Each source can have only one comparison bookmark',
      });
    }
    comparisonSourceIds.add(bookmark.sourceId);
    const source = sourcesById.get(bookmark.sourceId);
    if (!source) {
      context.addIssue({
        code: 'custom',
        path: ['sourceComparisons', index, 'sourceId'],
        message: 'Comparison bookmark must reference a source in the same project',
      });
      continue;
    }
    if (
      bookmark.firstMs < 100 ||
      bookmark.firstMs >= bookmark.secondMs ||
      source.durationMs - bookmark.secondMs < 100
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceComparisons', index],
        message: 'Comparison points must leave two valid 100 millisecond clips',
      });
    }
  }

  const crossfadeIds = new Set<string>();
  const crossfadeBoundaries = new Set<string>();
  const incomingByClipId = new Map<string, number>();
  const outgoingByClipId = new Map<string, number>();
  for (const [index, crossfade] of project.crossfades.entries()) {
    if (crossfadeIds.has(crossfade.id)) {
      context.addIssue({
        code: 'custom',
        path: ['crossfades', index, 'id'],
        message: 'Crossfade IDs must be unique',
      });
    }
    crossfadeIds.add(crossfade.id);
    const leftIndex = project.clips.findIndex(({ id }) => id === crossfade.leftClipId);
    const rightIndex = project.clips.findIndex(({ id }) => id === crossfade.rightClipId);
    if (leftIndex < 0 || rightIndex !== leftIndex + 1) {
      context.addIssue({
        code: 'custom',
        path: ['crossfades', index],
        message: 'Crossfade must bind two adjacent clips in canonical order',
      });
      continue;
    }
    const boundaryKey = `${crossfade.leftClipId}:${crossfade.rightClipId}`;
    if (crossfadeBoundaries.has(boundaryKey)) {
      context.addIssue({
        code: 'custom',
        path: ['crossfades', index],
        message: 'A clip boundary can contain only one crossfade',
      });
    }
    crossfadeBoundaries.add(boundaryKey);
    const left = project.clips[leftIndex]!;
    const right = project.clips[rightIndex]!;
    const leftSource = sourcesById.get(left.sourceId);
    const rightSource = sourcesById.get(right.sourceId);
    if (!leftSource || !rightSource) continue;
    const halfDurationMs = crossfade.durationMs / 2;
    if (leftSource.durationMs - left.endMs < halfDurationMs) {
      context.addIssue({
        code: 'custom',
        path: ['crossfades', index, 'durationMs'],
        message: 'The earlier clip source does not have enough audio after its end',
      });
    }
    if (right.startMs < halfDurationMs) {
      context.addIssue({
        code: 'custom',
        path: ['crossfades', index, 'durationMs'],
        message: 'The later clip source does not have enough audio before its start',
      });
    }
    outgoingByClipId.set(left.id, halfDurationMs);
    incomingByClipId.set(right.id, halfDurationMs);
  }
  project.clips.forEach((clip, index) => {
    const requiredMs = (incomingByClipId.get(clip.id) ?? 0) + (outgoingByClipId.get(clip.id) ?? 0);
    if (clip.endMs - clip.startMs < requiredMs) {
      context.addIssue({
        code: 'custom',
        path: ['clips', index],
        message: 'Clip is too short for its incoming and outgoing crossfades',
      });
    }
  });
}

const projectCommonShape = {
  id: uuidSchema,
  name: projectNameSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastExport: snapCutExportRecordSchema.nullable(),
};

export const snapCutProjectSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_PROJECT_SCHEMA_VERSION),
    ...projectCommonShape,
    clips: z.array(snapCutClipSchema),
    crossfades: z.array(snapCutCrossfadeSchema),
    namePromptCompleted: z.boolean(),
    sourceComparisons: z.array(sourceComparisonBookmarkSchema),
    sources: z.array(snapCutSourceSchema),
  })
  .strict()
  .superRefine(refineProjectRelations);

const {
  displayName: _displayNameSchema,
  waveformFileName: _waveformFileNameSchema,
  waveformStatus: _waveformStatusSchema,
  ...immutableSourceManifestShape
} = snapCutSourceShape;

export const immutableSourceManifestSchema = z
  .object(immutableSourceManifestShape)
  .strict()
  .superRefine(refineSourceCodecMetadata);

export const sourceFileSchema = z
  .object({
    schemaVersion: z.literal(SOURCE_FILE_SCHEMA_VERSION),
    projectId: uuidSchema,
    source: immutableSourceManifestSchema,
  })
  .strict();

const waveformValueSchema = z.number().finite().min(0).max(1);
export const waveformFileSchema = z
  .object({
    schemaVersion: z.literal(WAVEFORM_SCHEMA_VERSION),
    durationMs: positiveIntegerMillisecondsSchema,
    binCount: z.literal(WAVEFORM_BIN_COUNT),
    rms: z.array(waveformValueSchema).length(WAVEFORM_BIN_COUNT),
    peak: z.array(waveformValueSchema).length(WAVEFORM_BIN_COUNT),
  })
  .strict();

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

export const projectIndexSchema = z
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
    mode: snapCutExportModeSchema.nullable(),
    available: z.boolean(),
    reasons: z.array(nonEmptyStringSchema),
    estimatedOutputBytes: positiveIntegerSchema.nullable(),
    requiredFreeBytes: positiveIntegerSchema.nullable(),
    sampleRateHz: positiveIntegerSchema.nullable(),
    channelCount: channelCountSchema.nullable(),
  })
  .strict()
  .superRefine((availability, context) => {
    const validMode =
      availability.mode === null ||
      (availability.format === 'm4a' &&
        (availability.mode === 'aac-stream-copy' || availability.mode === 'aac-lossy-encode')) ||
      (availability.format === 'mp3' && availability.mode === 'mp3-lossy-encode');
    if (!validMode) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'Availability mode must match its export format',
      });
    }
    if (availability.available !== (availability.mode !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'Availability mode must be present exactly when the format is available',
      });
    }
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
    contractVersion: z.literal(1),
    preferredFormat: snapCutExportFormatSchema,
    m4aPlan: m4aExportPlanSchema,
    formats: z.array(exportFormatAvailabilitySchema).length(2),
    mayClip: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    const formats = new Set(result.formats.map(({ format }) => format));
    if (formats.size !== 2) {
      context.addIssue({
        code: 'custom',
        path: ['formats'],
        message: 'Preflight must include each format once',
      });
    }
    const m4aAvailable = result.formats.find(({ format }) => format === 'm4a')?.available === true;
    const expected = m4aAvailable ? 'm4a' : 'mp3';
    if (result.preferredFormat !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['preferredFormat'],
        message: 'Preferred format must follow M4A format availability',
      });
    }
  });
