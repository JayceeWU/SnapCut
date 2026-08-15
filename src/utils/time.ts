import { DomainError } from '../domain/errors';

const EXACT_TIME_PATTERN = /^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2})\.(\d{3})$/u;

export function assertIntegerMilliseconds(value: number, fieldName = 'milliseconds'): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError(
      'INVALID_TIMESTAMP',
      `${fieldName} must be a non-negative integer number of milliseconds`,
    );
  }

  return value;
}

/**
 * Parses SS.mmm, M:SS.mmm, or H:MM:SS.mmm into integer milliseconds.
 */
export function parseExactTime(value: string): number {
  const input = value.trim();
  const match = EXACT_TIME_PATTERN.exec(input);
  if (!match) {
    throw new DomainError('INVALID_TIMESTAMP', 'Time must use SS.mmm, M:SS.mmm, or H:MM:SS.mmm');
  }

  const [, firstGroup, secondGroup, secondsGroup, millisecondsGroup] = match;
  const hasHours = firstGroup !== undefined && secondGroup !== undefined;
  const hours = hasHours ? Number(firstGroup) : 0;
  const minutes = hasHours
    ? Number(secondGroup)
    : firstGroup === undefined
      ? 0
      : Number(firstGroup);
  const seconds = Number(secondsGroup);
  const milliseconds = Number(millisecondsGroup);

  if (seconds >= 60 || (hasHours && minutes >= 60)) {
    throw new DomainError('INVALID_TIMESTAMP', 'Minutes and seconds must be less than 60');
  }

  const result = ((hours * 60 + minutes) * 60 + seconds) * 1_000 + milliseconds;
  return assertIntegerMilliseconds(result, 'parsed time');
}

export function formatExactTime(valueMs: number): string {
  const totalMs = assertIntegerMilliseconds(valueMs);
  const milliseconds = totalMs % 1_000;
  const totalSeconds = Math.floor(totalMs / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const suffix = `${seconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${suffix}`;
  }

  if (totalMinutes > 0) {
    return `${totalMinutes}:${suffix}`;
  }

  return suffix;
}

/** Timeline display form: always M:SS.mmm, adding hours only when needed. */
export function formatTimelineTime(valueMs: number): string {
  const totalMs = assertIntegerMilliseconds(valueMs);
  const milliseconds = totalMs % 1_000;
  const totalSeconds = Math.floor(totalMs / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const suffix = `${seconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${suffix}`
    : `${totalMinutes}:${suffix}`;
}

export const formatTimestampMs = formatExactTime;
export const parseTimestampMs = parseExactTime;
