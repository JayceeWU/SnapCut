export interface WaveformViewport {
  startMs: number;
  endMs: number;
  durationMs: number;
  startBin: number;
  endBinExclusive: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function getWaveformViewport(
  binCount: number,
  durationMs: number,
  zoom: number,
  viewportStartMs: number,
): WaveformViewport {
  const safeBinCount = Math.max(1, Math.trunc(binCount));
  const safeDuration = Math.max(1, Math.trunc(durationMs));
  const safeZoom = clamp(zoom, 1, 32);
  const visibleDuration = safeDuration / safeZoom;
  const startMs = clamp(viewportStartMs, 0, safeDuration - visibleDuration);
  const endMs = startMs + visibleDuration;
  const startBin = clamp(Math.floor((startMs / safeDuration) * safeBinCount), 0, safeBinCount - 1);
  const endBinExclusive = clamp(
    Math.ceil((endMs / safeDuration) * safeBinCount),
    startBin + 1,
    safeBinCount,
  );
  return { startMs, endMs, durationMs: visibleDuration, startBin, endBinExclusive };
}

export function timeToViewportX(timeMs: number, viewport: WaveformViewport, width: number): number {
  if (width <= 0) return 0;
  return clamp(((timeMs - viewport.startMs) / viewport.durationMs) * width, 0, width);
}

export function viewportXToTime(x: number, viewport: WaveformViewport, width: number): number {
  if (width <= 0) return Math.round(viewport.startMs);
  return Math.round(viewport.startMs + (clamp(x, 0, width) / width) * viewport.durationMs);
}

function coordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function sampledAmplitudes(
  values: readonly number[],
  startIndex: number,
  endIndexExclusive: number,
  maximumPoints: number,
): number[] {
  const start = clamp(Math.trunc(startIndex), 0, Math.max(0, values.length - 1));
  const end = clamp(Math.trunc(endIndexExclusive), start + 1, values.length);
  const visibleCount = end - start;
  const pointCount = Math.max(2, Math.min(visibleCount, Math.trunc(maximumPoints)));

  return Array.from({ length: pointCount }, (_, pointIndex) => {
    const bucketStart = start + Math.floor((pointIndex * visibleCount) / pointCount);
    const bucketEnd = Math.max(
      bucketStart + 1,
      start + Math.floor(((pointIndex + 1) * visibleCount) / pointCount),
    );
    let maximum = 0;
    for (let index = bucketStart; index < Math.min(bucketEnd, end); index += 1) {
      const value = values[index];
      if (value !== undefined && Number.isFinite(value)) maximum = Math.max(maximum, value);
    }
    return clamp(maximum, 0, 1);
  });
}

function waveformPoints(
  values: readonly number[],
  width: number,
  height: number,
  startIndex: number,
  endIndexExclusive: number,
  maximumPoints: number,
): { top: string[]; bottom: string[] } {
  if (values.length === 0 || width <= 0 || height <= 0) return { top: [], bottom: [] };
  const amplitudes = sampledAmplitudes(values, startIndex, endIndexExclusive, maximumPoints);
  const center = height / 2;
  const halfHeight = Math.max(0, center - 1);
  const denominator = Math.max(1, amplitudes.length - 1);
  const top = amplitudes.map((amplitude, index) => {
    const x = (index / denominator) * width;
    return `${coordinate(x)} ${coordinate(center - amplitude * halfHeight)}`;
  });
  const bottom = amplitudes.map((amplitude, index) => {
    const x = (index / denominator) * width;
    return `${coordinate(x)} ${coordinate(center + amplitude * halfHeight)}`;
  });
  return { top, bottom };
}

export function buildWaveformFillPath(
  values: readonly number[],
  width: number,
  height: number,
  startIndex = 0,
  endIndexExclusive = values.length,
  maximumPoints = 1024,
): string {
  const { top, bottom } = waveformPoints(
    values,
    width,
    height,
    startIndex,
    endIndexExclusive,
    maximumPoints,
  );
  if (top.length === 0) return '';
  return `M ${top[0]} L ${top.slice(1).join(' L ')} L ${[...bottom].reverse().join(' L ')} Z`;
}

export function buildWaveformOutlinePath(
  values: readonly number[],
  width: number,
  height: number,
  startIndex = 0,
  endIndexExclusive = values.length,
  maximumPoints = 1024,
): string {
  const { top, bottom } = waveformPoints(
    values,
    width,
    height,
    startIndex,
    endIndexExclusive,
    maximumPoints,
  );
  if (top.length === 0) return '';
  return `M ${top.join(' L ')} M ${bottom.join(' L ')}`;
}
