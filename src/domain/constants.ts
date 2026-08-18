export const CURRENT_PROJECT_SCHEMA_VERSION = 9 as const;
export const PROJECT_INDEX_SCHEMA_VERSION = 1 as const;
export const SOURCE_FILE_SCHEMA_VERSION = 2 as const;
export const WAVEFORM_SCHEMA_VERSION = 1 as const;

export const DEFAULT_PROJECT_NAME = 'Untitled Project';
export const MAX_PROJECT_NAME_CODE_POINTS = 80;
export const MAX_SOURCE_NAME_CODE_POINTS = 6;
export const MAX_EXPORT_BASENAME_CODE_POINTS = 100;
export const MIN_CLIP_DURATION_MS = 100;
export const DEFAULT_COMPARISON_VISIBLE_SPAN_MS = 10_000;
export const MIN_COMPARISON_VISIBLE_SPAN_MS = 1_000;
export const MAX_COMPARISON_VISIBLE_SPAN_MS = 10_000;
export const COMPARISON_VISIBLE_SPAN_STEP_MS = 1_000;
export const COMPARISON_PREVIEW_CONTEXT_MS = 5_000;
export const WAVEFORM_BIN_COUNT = 8_192 as const;

export const FADE_DURATION_STEP_MS = 500 as const;
export const MAX_FADE_DURATION_MS = 8_000 as const;
export const CROSSFADE_DURATION_VALUES_MS = [1_000, 2_000, 4_000, 6_000, 8_000] as const;
