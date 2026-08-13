export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function truncateUnicodeCodePoints(value: string, maximum: number): string {
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new RangeError('maximum must be a non-negative safe integer');
  }

  return Array.from(value).slice(0, maximum).join('');
}
