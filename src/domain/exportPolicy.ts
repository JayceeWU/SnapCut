import type { DecodedExportSampleRate } from './constants';
import { DomainError } from './errors';
import type { SnapCutExportFormat, SnapCutExportMode } from './types';
import { assertIntegerMilliseconds } from '../utils/time';

export const EXPORT_FORMAT_DETAILS = {
  m4a: {
    mode: 'aac-stream-copy',
    extension: 'm4a',
    mimeType: 'audio/mp4',
    label: 'M4A · No re-encoding',
  },
  flac: {
    mode: 'flac-lossless-encode',
    extension: 'flac',
    mimeType: 'audio/flac',
    label: 'FLAC · Lossless',
  },
  mp3: {
    mode: 'mp3-lossy-encode',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    label: 'MP3 · 320 kbps',
  },
} as const satisfies Record<
  SnapCutExportFormat,
  { mode: SnapCutExportMode; extension: string; mimeType: string; label: string }
>;

export function exportModeForFormat(format: SnapCutExportFormat): SnapCutExportMode {
  return EXPORT_FORMAT_DETAILS[format].mode;
}

export function selectOutputSampleRateHz(
  sampleRatesHz: readonly number[],
): DecodedExportSampleRate {
  if (sampleRatesHz.length === 0) {
    throw new DomainError('EMPTY_COMPOSITION', 'At least one clip sample rate is required');
  }
  if (!sampleRatesHz.every((rate) => Number.isSafeInteger(rate) && rate > 0)) {
    throw new DomainError('INVALID_SAMPLE_RATE', 'Sample rates must be positive integers');
  }

  const first = sampleRatesHz[0]!;
  if (
    sampleRatesHz.every((rate) => rate === first) &&
    (first === 32_000 || first === 44_100 || first === 48_000)
  ) {
    return first;
  }

  return sampleRatesHz.some((rate) => rate >= 48_000) ? 48_000 : 44_100;
}

export function selectOutputChannelCount(channelCounts: readonly number[]): 1 | 2 {
  if (channelCounts.length === 0) {
    throw new DomainError('EMPTY_COMPOSITION', 'At least one clip channel count is required');
  }
  if (!channelCounts.every((count) => count === 1 || count === 2)) {
    throw new DomainError(
      'UNSUPPORTED_CHANNEL_COUNT',
      'SnapCut supports only mono and stereo sources',
    );
  }

  return channelCounts.every((count) => count === 1) ? 1 : 2;
}

export function selectDefaultExportFormat(m4aEligible: boolean): 'm4a' | 'flac' {
  return m4aEligible ? 'm4a' : 'flac';
}

export function firstM4aDisabledReason(reasons: readonly string[]): string | null {
  return reasons.find((reason) => reason.trim().length > 0)?.trim() ?? null;
}

export function estimateMp3OutputBytes(compositionDurationMs: number): number {
  const durationMs = assertIntegerMilliseconds(compositionDurationMs, 'compositionDurationMs');
  return Math.ceil((durationMs / 1_000) * (320_000 / 8));
}

export function estimateFlacPcmUpperBoundBytes(
  compositionDurationMs: number,
  outputSampleRateHz: DecodedExportSampleRate,
  outputChannelCount: 1 | 2,
): number {
  const durationMs = assertIntegerMilliseconds(compositionDurationMs, 'compositionDurationMs');
  const rawPcmBytes = Math.ceil((durationMs / 1_000) * outputSampleRateHz * outputChannelCount * 3);
  return Math.ceil(rawPcmBytes * 1.02);
}

export const chooseOutputSampleRateHz = selectOutputSampleRateHz;
export const chooseOutputChannelCount = selectOutputChannelCount;
export const chooseDefaultExportFormat = selectDefaultExportFormat;
