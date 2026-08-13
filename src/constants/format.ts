const padTwo = (value: number): string => value.toString().padStart(2, '0');

export function formatDuration(durationMs: number): string {
  const safeSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return hours > 0
    ? `${hours}:${padTwo(minutes)}:${padTwo(seconds)}`
    : `${minutes}:${padTwo(seconds)}`;
}

export function formatUpdatedAt(isoDate: string, now = new Date()): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }

  const elapsedMs = Math.max(0, now.getTime() - date.getTime());
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);

  if (elapsedDays === 0) {
    return 'today';
  }
  if (elapsedDays === 1) {
    return 'yesterday';
  }
  if (elapsedDays < 7) {
    return `${elapsedDays} days ago`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
