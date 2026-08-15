export const CURRENT_PROJECT_SCHEMA_VERSION = 6 as const;
export const PROJECT_INDEX_SCHEMA_VERSION = 1 as const;
export const SOURCE_FILE_SCHEMA_VERSION = 1 as const;
export const WAVEFORM_SCHEMA_VERSION = 1 as const;

export const DEFAULT_PROJECT_NAME = 'Untitled Project';
export const MAX_PROJECT_NAME_CODE_POINTS = 80;
export const MAX_EXPORT_BASENAME_CODE_POINTS = 100;
export const MIN_CLIP_DURATION_MS = 100;
export const DEFAULT_SELECTION_DURATION_MS = 30_000;
export const WAVEFORM_BIN_COUNT = 8_192 as const;

export const TRACK_IDS = ['track-1', 'track-2'] as const;
export const FADE_DURATION_STEP_MS = 500 as const;
export const MAX_FADE_DURATION_MS = 6_000 as const;
export const FADE_DURATION_VALUES_MS = [
  0, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500, 4_000, 4_500, 5_000, 5_500, 6_000,
] as const;

export const DECODED_EXPORT_SAMPLE_RATES = [32_000, 44_100, 48_000] as const;
export type DecodedExportSampleRate = (typeof DECODED_EXPORT_SAMPLE_RATES)[number];
