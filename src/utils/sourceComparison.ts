import {
  COMPARISON_VISIBLE_SPAN_STEP_MS,
  DEFAULT_COMPARISON_VISIBLE_SPAN_MS,
  MAX_COMPARISON_VISIBLE_SPAN_MS,
  MIN_COMPARISON_VISIBLE_SPAN_MS,
} from '@/domain';
import type { SourceComparisonBookmark, WaveformFile } from '@/domain';
import { buildWaveformFillPath } from './waveform';

export interface ComparisonPositions {
  firstMs: number;
  secondMs: number;
}

export const clampComparisonTime = (value: number, durationMs: number): number =>
  Math.min(Math.max(Math.round(Number.isFinite(value) ? value : 0), 0), Math.max(0, durationMs));

export function comparisonVisibleSpanBounds(durationMs: number): {
  minimum: number;
  maximum: number;
} {
  const wholeSourceSeconds = Math.floor(Math.max(0, durationMs) / COMPARISON_VISIBLE_SPAN_STEP_MS);
  const maximum = Math.min(
    MAX_COMPARISON_VISIBLE_SPAN_MS,
    Math.max(MIN_COMPARISON_VISIBLE_SPAN_MS, wholeSourceSeconds * COMPARISON_VISIBLE_SPAN_STEP_MS),
  );
  return { minimum: MIN_COMPARISON_VISIBLE_SPAN_MS, maximum };
}

export function snapComparisonVisibleSpan(value: number, durationMs: number): number {
  const { minimum, maximum } = comparisonVisibleSpanBounds(durationMs);
  const snapped =
    Math.round(value / COMPARISON_VISIBLE_SPAN_STEP_MS) * COMPARISON_VISIBLE_SPAN_STEP_MS;
  return Math.min(Math.max(snapped, minimum), maximum);
}

export function defaultComparisonVisibleSpan(durationMs: number): number {
  return snapComparisonVisibleSpan(DEFAULT_COMPARISON_VISIBLE_SPAN_MS, durationMs);
}

export const comparisonResultDurationMs = (
  durationMs: number,
  firstMs: number,
  secondMs: number,
): number => Math.max(0, firstMs) + Math.max(0, durationMs - secondMs);

export const comparisonResultSourceTimeMs = (
  resultPositionMs: number,
  firstMs: number,
  secondMs: number,
): number => {
  const position = Math.max(0, resultPositionMs);
  return position <= firstMs ? position : secondMs + position - firstMs;
};

export function comparisonResultPath(
  waveform: WaveformFile,
  durationMs: number,
  firstMs: number,
  secondMs: number,
  width: number,
  height: number,
): string {
  const resultDurationMs = comparisonResultDurationMs(durationMs, firstMs, secondMs);
  if (width <= 0 || height <= 0 || durationMs <= 0 || resultDurationMs <= 0) return '';
  const pointCount = Math.max(2, Math.min(512, Math.ceil(width * 2)));
  const samples = Array.from({ length: pointCount }, (_, index) => {
    const resultTimeMs = (index / Math.max(1, pointCount - 1)) * resultDurationMs;
    const sourceTimeMs = comparisonResultSourceTimeMs(resultTimeMs, firstMs, secondMs);
    const bin = Math.min(
      waveform.rms.length - 1,
      Math.max(0, Math.floor((sourceTimeMs / durationMs) * waveform.rms.length)),
    );
    return waveform.rms[bin] ?? 0;
  });
  return buildWaveformFillPath(samples, width, height, 0, samples.length, samples.length);
}

export function initialComparisonPositions(
  durationMs: number,
  bookmark?: SourceComparisonBookmark | null,
): ComparisonPositions {
  if (bookmark) return { firstMs: bookmark.firstMs, secondMs: bookmark.secondMs };
  const safeDuration = Math.max(200, Math.round(durationMs));
  const firstMs = Math.max(100, Math.round(safeDuration / 3));
  const secondMs = Math.min(
    safeDuration - 100,
    Math.max(firstMs + 1, Math.round((safeDuration * 2) / 3)),
  );
  return { firstMs, secondMs };
}

export function comparisonWindowPath(
  waveform: WaveformFile,
  durationMs: number,
  centerMs: number,
  visibleSpanMs: number,
  width: number,
  height: number,
): string {
  if (width <= 0 || height <= 0 || durationMs <= 0 || waveform.rms.length === 0) return '';
  const pointCount = Math.max(2, Math.min(512, Math.ceil(width * 2)));
  const windowStartMs = centerMs - visibleSpanMs / 2;
  const samples = Array.from({ length: pointCount }, (_, index) => {
    const timeMs = windowStartMs + (index / Math.max(1, pointCount - 1)) * visibleSpanMs;
    if (timeMs < 0 || timeMs > durationMs) return 0;
    const bin = Math.min(
      waveform.rms.length - 1,
      Math.max(0, Math.floor((timeMs / durationMs) * waveform.rms.length)),
    );
    return waveform.rms[bin] ?? 0;
  });
  return buildWaveformFillPath(samples, width, height, 0, samples.length, samples.length);
}
