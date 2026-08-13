import { requireNativeModule } from 'expo';
import { z } from 'zod';

import {
  exportPreflightResultSchema,
  m4aExportPlanSchema,
  snapCutExportFormatSchema,
  snapCutExportModeSchema,
  sourceKindSchema,
} from '@/domain';
import type { NativeEventMap, SnapCutMediaEventApi } from './SnapCutMedia.events';
import {
  SNAP_CUT_MEDIA_ERROR_CODES,
  type CodecBuildInfo,
  type ExportAudioResult,
  type ImportResult,
  type NativeEventName,
  type NativeHealth,
  type PickedSource,
  type PrivateMediaVerificationResult,
  type SnapCutMediaApi,
  type SnapCutMediaErrorCode,
  type SnapCutMediaNativeModule,
  type SourceInspection,
} from './SnapCutMedia.types';

const MODULE_NAME = 'SnapCutMedia';

const nonNegativeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger);
const positiveInteger = nonNegativeInteger.refine((value) => value > 0);
const nullablePositiveInteger = positiveInteger.nullable();
const channelCount = z.union([z.literal(1), z.literal(2)]);
const aacProfile = z.enum(['aac-lc', 'he-aac-v1', 'he-aac-v2']).nullable();
const fingerprint = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .nullable();
const fileUri = z.string().regex(/^file:\/{1,3}[^\s]+$/u);
const sourceUri = z
  .string()
  .refine(
    (value) => value.startsWith('content://') || value.startsWith('file://'),
    'Source must use content:// or file://',
  );
const contentUri = z.string().regex(/^content:\/\/[^\s]+$/u);
const nonEmptyId = z.string().trim().min(1);

const inspectSourceRequestSchema = z
  .object({
    jobId: nonEmptyId,
    generation: nonNegativeInteger,
    sourceUri,
    maxSourceBytes: positiveInteger,
  })
  .strict();
const verifyPrivateMediaRequestSchema = z.object({ fileUri }).strict();
const importSourceRequestSchema = z
  .object({
    jobId: nonEmptyId,
    generation: nonNegativeInteger,
    sourceUri,
    outputFileUri: fileUri,
    maxSourceBytes: positiveInteger,
  })
  .strict();
const nativePreviewClipSchema = z
  .object({
    clipId: nonEmptyId,
    sourceId: nonEmptyId,
    audioFileUri: fileUri,
    startMs: nonNegativeInteger,
    endMs: positiveInteger,
  })
  .strict()
  .refine((clip) => clip.endMs - clip.startMs >= 100, 'Clip range must be at least 100 ms');
const loadPreviewRequestSchema = z
  .object({
    playbackSessionId: nonEmptyId,
    generation: nonNegativeInteger,
    clips: z.array(nativePreviewClipSchema).min(1),
  })
  .strict();
const previewCommandRequestSchema = z
  .object({ playbackSessionId: nonEmptyId, generation: nonNegativeInteger })
  .strict();
const seekPreviewRequestSchema = previewCommandRequestSchema
  .extend({ positionMs: nonNegativeInteger })
  .strict();
const exportPreflightRequestSchema = z
  .object({
    jobId: nonEmptyId,
    generation: nonNegativeInteger,
    projectId: nonEmptyId,
    clips: z.array(nativePreviewClipSchema).min(1),
  })
  .strict();
const generateWaveformRequestSchema = z
  .object({
    jobId: nonEmptyId,
    generation: nonNegativeInteger,
    sourceId: nonEmptyId,
    audioFileUri: fileUri,
    outputWaveformFileUri: fileUri,
    binCount: z.literal(8192),
  })
  .strict();
const exportAudioRequestSchema = z
  .object({
    jobId: nonEmptyId,
    generation: nonNegativeInteger,
    projectId: nonEmptyId,
    format: snapCutExportFormatSchema,
    displayNameWithoutExtension: z.string().trim().min(1).max(100),
    clips: z.array(nativePreviewClipSchema).min(1),
    outputSampleRateHz: z
      .union([z.literal(32_000), z.literal(44_100), z.literal(48_000)])
      .nullable(),
    outputChannelCount: channelCount.nullable(),
    m4aPlan: m4aExportPlanSchema.nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.format === 'm4a') {
      if (request.m4aPlan === null || !request.m4aPlan.eligible) {
        context.addIssue({
          code: 'custom',
          path: ['m4aPlan'],
          message: 'M4A export requires an eligible immutable plan',
        });
      }
      if (request.outputSampleRateHz !== null || request.outputChannelCount !== null) {
        context.addIssue({
          code: 'custom',
          message: 'M4A export takes rate and channels from the immutable plan',
        });
      }
    } else {
      if (request.m4aPlan !== null) {
        context.addIssue({
          code: 'custom',
          path: ['m4aPlan'],
          message: 'Decoded export cannot carry an M4A plan',
        });
      }
      if (request.outputSampleRateHz === null || request.outputChannelCount === null) {
        context.addIssue({
          code: 'custom',
          message: 'Decoded export requires an output sample rate and channel count',
        });
      }
    }
  });
const shareExportRequestSchema = z
  .object({ contentUri, format: snapCutExportFormatSchema })
  .strict();

const healthSchema = z
  .object({
    moduleName: z.literal('SnapCutMedia'),
    moduleVersion: z.literal('1.0.0'),
    platform: z.literal('android'),
    ready: z.boolean(),
    mediaPipelineAvailable: z.boolean(),
  })
  .strict();

const libraryStatusSchema = z
  .object({ version: z.string().min(1).nullable(), available: z.boolean() })
  .strict();
const codecBuildInfoSchema = z
  .object({
    moduleVersion: z.literal('1.0.0'),
    media3: libraryStatusSchema,
    flac: libraryStatusSchema,
    lame: libraryStatusSchema,
    libsamplerate: libraryStatusSchema,
    nativeCodecBridgeLoaded: z.boolean(),
  })
  .strict();

const pickedSourceSchema = z
  .object({
    sourceUri,
    suggestedName: z.string().trim().min(1).nullable(),
    suggestedMimeType: z.string().trim().min(1).nullable(),
    suggestedSizeBytes: nullablePositiveInteger,
  })
  .strict();

const sourceInspectionSchema = z
  .object({
    sourceKind: sourceKindSchema,
    codecMime: z.string().regex(/^audio\//u),
    durationMs: positiveInteger,
    sampleRateHz: positiveInteger,
    channelCount,
    encodedBitrateBps: nullablePositiveInteger,
    pcmBitsPerSample: z
      .union([z.literal(8), z.literal(16), z.literal(24), z.literal(32)])
      .nullable(),
    aacProfile,
    codecConfigFingerprint: fingerprint,
    encoderDelayFrames: nonNegativeInteger.nullable(),
    encoderPaddingFrames: nonNegativeInteger.nullable(),
    fileSizeBytes: nullablePositiveInteger,
    requiresStreamingSizeVerification: z.boolean(),
    drmProtected: z.boolean(),
  })
  .strict();

const importResultSchema = sourceInspectionSchema
  .omit({ fileSizeBytes: true, requiresStreamingSizeVerification: true, drmProtected: true })
  .extend({
    outputFileUri: fileUri,
    fileSizeBytes: positiveInteger,
    privateAudioSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const privateMediaVerificationResultSchema = z
  .object({
    fileSizeBytes: positiveInteger,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const exportAudioResultSchema = z
  .object({
    format: snapCutExportFormatSchema,
    mode: snapCutExportModeSchema,
    contentUri,
    displayName: z.string().trim().min(1),
    requestedDurationMs: positiveInteger,
    actualDurationMs: positiveInteger,
    sampleRateHz: positiveInteger,
    channelCount,
    bitrateKbps: z.literal(320).nullable(),
    bitsPerSample: z.literal(24).nullable(),
    maxBoundaryAdjustmentMs: nonNegativeInteger,
    fileSizeBytes: positiveInteger,
  })
  .strict();

const nativeOperationSchema = z.enum(['import', 'waveform', 'preflight', 'export', 'preview']);
const baseJobEventShape = {
  jobId: z.string().trim().min(1),
  operation: nativeOperationSchema,
  sequence: positiveInteger,
  stage: z.string().trim().min(1),
  generation: nonNegativeInteger,
};
const progressEventSchema = z
  .object({
    ...baseJobEventShape,
    fraction: z.number().finite().min(0).max(1).nullable(),
    format: snapCutExportFormatSchema.optional(),
  })
  .strict();
const playbackStatusEventSchema = z
  .object({
    ...baseJobEventShape,
    playbackSessionId: z.string().trim().min(1),
    mode: z.enum(['selection', 'composition']),
    loaded: z.boolean(),
    playing: z.boolean(),
    positionMs: nonNegativeInteger,
    durationMs: nonNegativeInteger,
    currentClipIndex: nonNegativeInteger.nullable(),
    currentClipId: z.string().trim().min(1).nullable(),
    didJustFinish: z.boolean(),
  })
  .strict();
const nativeErrorEventSchema = z
  .object({
    ...baseJobEventShape,
    code: z.enum(SNAP_CUT_MEDIA_ERROR_CODES),
    message: z.string().trim().min(1),
    nativeStage: z.string().trim().min(1).max(40).optional(),
    causeCategory: z
      .enum(['provider', 'extractor', 'decoder', 'job', 'linkage', 'native'])
      .optional(),
    format: snapCutExportFormatSchema.optional(),
  })
  .strict();
const eventSchemas = {
  onImportProgress: progressEventSchema,
  onWaveformProgress: progressEventSchema,
  onPlaybackStatus: playbackStatusEventSchema,
  onExportProgress: progressEventSchema,
  onNativeError: nativeErrorEventSchema,
} as const;

export class SnapCutMediaContractError extends Error {
  readonly code = 'INVALID_NATIVE_RESULT' as const;
  readonly issuePaths: readonly string[];

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SnapCutMediaContractError';
    this.issuePaths =
      cause instanceof z.ZodError
        ? [...new Set(cause.issues.map((issue) => issue.path.join('.')).filter(Boolean))].slice(
            0,
            6,
          )
        : [];
  }
}

export function isSnapCutMediaErrorCode(value: unknown): value is SnapCutMediaErrorCode {
  return (
    typeof value === 'string' && (SNAP_CUT_MEDIA_ERROR_CODES as readonly string[]).includes(value)
  );
}

function parseNative<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SnapCutMediaContractError(
      `${label} violated the SnapCut native contract`,
      result.error,
    );
  }
  return result.data;
}

export function createSnapCutMediaClient(
  getNativeModule: () => SnapCutMediaNativeModule,
): SnapCutMediaApi & SnapCutMediaEventApi {
  return {
    getHealth(): NativeHealth {
      return parseNative(healthSchema, getNativeModule().getHealth(), 'getHealth');
    },
    getCodecBuildInfo(): CodecBuildInfo {
      return parseNative(
        codecBuildInfoSchema,
        getNativeModule().getCodecBuildInfo(),
        'getCodecBuildInfo',
      );
    },
    async pickSource(): Promise<PickedSource | null> {
      const value: unknown = await getNativeModule().pickSource();
      return value === null ? null : parseNative(pickedSourceSchema, value, 'pickSource');
    },
    async inspectSource(request) {
      const safeRequest = parseNative(inspectSourceRequestSchema, request, 'inspectSource request');
      const value: unknown = await getNativeModule().inspectSource(safeRequest);
      return parseNative(sourceInspectionSchema, value, 'inspectSource') as SourceInspection;
    },
    async verifyPrivateMedia(request) {
      const safeRequest = parseNative(
        verifyPrivateMediaRequestSchema,
        request,
        'verifyPrivateMedia request',
      );
      const value: unknown = await getNativeModule().verifyPrivateMedia(safeRequest);
      return parseNative(
        privateMediaVerificationResultSchema,
        value,
        'verifyPrivateMedia',
      ) as PrivateMediaVerificationResult;
    },
    async importSource(request) {
      const safeRequest = parseNative(importSourceRequestSchema, request, 'importSource request');
      const value: unknown = await getNativeModule().importSource(safeRequest);
      const result = parseNative(importResultSchema, value, 'importSource') as ImportResult;
      if (result.outputFileUri !== safeRequest.outputFileUri) {
        throw new SnapCutMediaContractError(
          'importSource changed the caller-provided outputFileUri',
        );
      }
      return result;
    },
    async cancelImport(jobId) {
      await getNativeModule().cancelImport(parseNative(nonEmptyId, jobId, 'cancelImport jobId'));
    },
    async generateWaveform(request) {
      await getNativeModule().generateWaveform(
        parseNative(generateWaveformRequestSchema, request, 'generateWaveform request'),
      );
    },
    async cancelWaveform(jobId) {
      await getNativeModule().cancelWaveform(
        parseNative(nonEmptyId, jobId, 'cancelWaveform jobId'),
      );
    },
    async loadSelectionPreview(request) {
      await getNativeModule().loadSelectionPreview(
        parseNative(loadPreviewRequestSchema, request, 'loadSelectionPreview request'),
      );
    },
    async loadCompositionPreview(request) {
      await getNativeModule().loadCompositionPreview(
        parseNative(loadPreviewRequestSchema, request, 'loadCompositionPreview request'),
      );
    },
    async playPreview(request) {
      await getNativeModule().playPreview(
        parseNative(previewCommandRequestSchema, request, 'playPreview request'),
      );
    },
    async pausePreview(request) {
      await getNativeModule().pausePreview(
        parseNative(previewCommandRequestSchema, request, 'pausePreview request'),
      );
    },
    async seekPreview(request) {
      await getNativeModule().seekPreview(
        parseNative(seekPreviewRequestSchema, request, 'seekPreview request'),
      );
    },
    async releasePreview(request) {
      await getNativeModule().releasePreview(
        parseNative(previewCommandRequestSchema, request, 'releasePreview request'),
      );
    },
    async preflightExport(request) {
      const safeRequest = parseNative(
        exportPreflightRequestSchema,
        request,
        'preflightExport request',
      );
      const value: unknown = await getNativeModule().preflightExport(safeRequest);
      return parseNative(exportPreflightResultSchema, value, 'preflightExport');
    },
    async cancelExportPreflight(jobId) {
      await getNativeModule().cancelExportPreflight(
        parseNative(nonEmptyId, jobId, 'cancelExportPreflight jobId'),
      );
    },
    async exportAudio(request) {
      const safeRequest = parseNative(exportAudioRequestSchema, request, 'exportAudio request');
      const value: unknown = await getNativeModule().exportAudio(safeRequest);
      return parseNative(exportAudioResultSchema, value, 'exportAudio') as ExportAudioResult;
    },
    async cancelExport(jobId) {
      await getNativeModule().cancelExport(parseNative(nonEmptyId, jobId, 'cancelExport jobId'));
    },
    async shareExport(request) {
      await getNativeModule().shareExport(
        parseNative(shareExportRequestSchema, request, 'shareExport request'),
      );
    },
    addEventListener<EventName extends NativeEventName>(
      eventName: EventName,
      listener: (event: NativeEventMap[EventName]) => void,
    ) {
      return getNativeModule().addListener(eventName, (event: unknown) => {
        const schema: z.ZodType = eventSchemas[eventName];
        listener(parseNative(schema, event, eventName) as NativeEventMap[EventName]);
      });
    },
  };
}

let nativeModule: SnapCutMediaNativeModule | undefined;
function getRequiredNativeModule(): SnapCutMediaNativeModule {
  nativeModule ??= requireNativeModule<SnapCutMediaNativeModule>(MODULE_NAME);
  return nativeModule;
}

const SnapCutMedia = createSnapCutMediaClient(getRequiredNativeModule);
export default SnapCutMedia;
