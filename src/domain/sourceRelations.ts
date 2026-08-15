import { snapCutSourceSchema } from './schemas';
import type { SnapCutSource } from './types';

export type ImmutableSourceMetadata = Omit<SnapCutSource, 'waveformStatus'>;

/**
 * source.json is an immutable import manifest. Waveform processing is a
 * project-level lifecycle concern and is intentionally excluded; every other
 * persisted source field remains part of the strict relation contract.
 */
export function immutableSourceMetadata(sourceInput: SnapCutSource): ImmutableSourceMetadata {
  const source = snapCutSourceSchema.parse(sourceInput) as SnapCutSource;
  const { waveformStatus: _waveformStatus, ...immutable } = source;
  return immutable;
}

export function sourceMetadataMatchesProjectSource(
  sourceFileSource: SnapCutSource,
  projectSource: SnapCutSource,
): boolean {
  return (
    JSON.stringify(immutableSourceMetadata(sourceFileSource)) ===
    JSON.stringify(immutableSourceMetadata(projectSource))
  );
}
