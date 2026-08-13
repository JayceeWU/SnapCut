import type { SnapCutMediaErrorCode } from '@/native/SnapCutMedia.types';

export type ImportFailureCode = SnapCutMediaErrorCode | 'INVALID_NATIVE_RESULT';

export interface ImportFailure {
  readonly code: ImportFailureCode;
  readonly message: string;
  readonly retryable: boolean;
}

const IMPORT_MESSAGES: Readonly<Record<ImportFailureCode, string>> = {
  INVALID_REQUEST: 'The import request is invalid.',
  NATIVE_FEATURE_UNAVAILABLE: 'Media import is unavailable in this build.',
  SOURCE_NOT_FOUND: 'The selected file is no longer available.',
  SOURCE_PERMISSION_DENIED: 'SnapCut no longer has permission to read the selected file.',
  SOURCE_UNREADABLE: 'The selected file could not be read.',
  SOURCE_TOO_LARGE: 'The selected file is larger than the 600 MiB import limit.',
  NO_AUDIO_TRACK: 'The selected file does not contain a supported audio track.',
  UNSUPPORTED_MEDIA: 'This media format is not supported.',
  UNSUPPORTED_AUDIO_CODEC: 'This audio codec is not supported on this device.',
  UNSUPPORTED_CHANNEL_COUNT: 'SnapCut supports mono and stereo sources only.',
  M4S_INIT_MISSING: 'This M4S fragment needs a separate initialization segment.',
  DRM_UNSUPPORTED: 'DRM-protected media cannot be imported.',
  CORRUPT_MEDIA: 'The selected media is damaged or incomplete.',
  DISK_SPACE_LOW: 'There is not enough free storage to import this source.',
  OUTPUT_WRITE_FAILED: 'SnapCut could not create its private source copy.',
  PATH_OUTSIDE_PRIVATE_STORAGE: 'The private import destination was rejected.',
  OUTPUT_ALIASES_SOURCE: 'The import source and private destination must be different files.',
  IMPORT_CANCELLED: 'Import was cancelled.',
  IMPORT_VERIFICATION_FAILED: 'The private source copy could not be verified.',
  WAVEFORM_DECODE_FAILED: 'The waveform could not be generated.',
  WAVEFORM_CANCELLED: 'Waveform generation was cancelled.',
  INVALID_CLIP_RANGE: 'A clip range is invalid.',
  MISSING_SOURCE_FILE: 'The private source file is missing.',
  PREVIEW_PREPARE_FAILED: 'Preview could not be prepared.',
  PREVIEW_SEEK_FAILED: 'Preview could not seek to that position.',
  JOB_ALREADY_RUNNING: 'Another media task is already running.',
  EXPORT_EMPTY_COMPOSITION: 'Add at least one clip before exporting.',
  EXPORT_FORMAT_UNAVAILABLE: 'The selected export format is unavailable.',
  EXPORT_PREFLIGHT_FAILED: 'Export requirements could not be checked.',
  M4A_NOT_ELIGIBLE: 'This composition cannot use M4A stream copy.',
  M4A_PLAN_STALE: 'The M4A export plan is out of date.',
  M4A_INCOMPATIBLE_CODEC_CONFIG: 'The selected AAC sources are incompatible.',
  M4A_BOUNDARY_ALIGNMENT_FAILED: 'Clip boundaries could not be aligned for M4A.',
  M4A_MUX_FAILED: 'The M4A file could not be created.',
  M4A_VERIFICATION_FAILED: 'The M4A file could not be verified.',
  EXPORT_DECODE_FAILED: 'A source could not be decoded for export.',
  EXPORT_RESAMPLE_FAILED: 'Audio conversion failed during export.',
  FLAC_ENCODER_INIT_FAILED: 'The FLAC encoder could not start.',
  FLAC_ENCODER_FAILED: 'FLAC encoding failed.',
  FLAC_VERIFICATION_FAILED: 'The FLAC file could not be verified.',
  MP3_ENCODER_INIT_FAILED: 'The MP3 encoder could not start.',
  MP3_ENCODER_FAILED: 'MP3 encoding failed.',
  MP3_VERIFICATION_FAILED: 'The MP3 file could not be verified.',
  EXPORT_MEDIASTORE_FAILED: 'The exported file could not be saved.',
  EXPORT_CANCELLED: 'Export was cancelled.',
  NATIVE_LIBRARY_LOAD_FAILED: 'A required audio library could not be loaded.',
  UNKNOWN_NATIVE_ERROR: 'Import failed unexpectedly.',
  INVALID_NATIVE_RESULT: 'The native import result did not pass integrity checks.',
};

const IMPORT_RELEVANT_CODES = new Set<ImportFailureCode>([
  'INVALID_REQUEST',
  'NATIVE_FEATURE_UNAVAILABLE',
  'SOURCE_NOT_FOUND',
  'SOURCE_PERMISSION_DENIED',
  'SOURCE_UNREADABLE',
  'SOURCE_TOO_LARGE',
  'NO_AUDIO_TRACK',
  'UNSUPPORTED_MEDIA',
  'UNSUPPORTED_AUDIO_CODEC',
  'UNSUPPORTED_CHANNEL_COUNT',
  'M4S_INIT_MISSING',
  'DRM_UNSUPPORTED',
  'CORRUPT_MEDIA',
  'DISK_SPACE_LOW',
  'OUTPUT_WRITE_FAILED',
  'PATH_OUTSIDE_PRIVATE_STORAGE',
  'OUTPUT_ALIASES_SOURCE',
  'IMPORT_CANCELLED',
  'IMPORT_VERIFICATION_FAILED',
  'JOB_ALREADY_RUNNING',
  'NATIVE_LIBRARY_LOAD_FAILED',
  'UNKNOWN_NATIVE_ERROR',
  'INVALID_NATIVE_RESULT',
]);

const LEGACY_CODE_ALIASES: Readonly<Record<string, ImportFailureCode>> = {
  PICKER_CANCELLED: 'IMPORT_CANCELLED',
  SOURCE_SIZE_UNAVAILABLE: 'SOURCE_UNREADABLE',
  SOURCE_TOO_LARGE_FOR_AVAILABLE_STORAGE: 'SOURCE_TOO_LARGE',
  M4S_MISSING_INITIALIZATION: 'M4S_INIT_MISSING',
  DRM_PROTECTED_SOURCE: 'DRM_UNSUPPORTED',
  IMPORT_REMUX_FAILED: 'OUTPUT_WRITE_FAILED',
  IMPORT_COPY_FAILED: 'OUTPUT_WRITE_FAILED',
  INSUFFICIENT_STORAGE: 'DISK_SPACE_LOW',
};

function candidateCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  return typeof error.code === 'string' ? error.code : null;
}

export function importFailure(code: ImportFailureCode): ImportFailure {
  return {
    code,
    message: IMPORT_MESSAGES[code],
    retryable: ![
      'DRM_UNSUPPORTED',
      'UNSUPPORTED_AUDIO_CODEC',
      'UNSUPPORTED_CHANNEL_COUNT',
      'M4S_INIT_MISSING',
    ].includes(code),
  };
}

export function mapImportError(error: unknown): ImportFailure {
  const candidate = candidateCode(error);
  const aliased = candidate === null ? undefined : LEGACY_CODE_ALIASES[candidate];
  if (aliased !== undefined) {
    return importFailure(aliased);
  }
  if (candidate !== null && IMPORT_RELEVANT_CODES.has(candidate as ImportFailureCode)) {
    return importFailure(candidate as ImportFailureCode);
  }
  return importFailure('UNKNOWN_NATIVE_ERROR');
}

export function invalidNativeResultFailure(): ImportFailure {
  return importFailure('INVALID_NATIVE_RESULT');
}
