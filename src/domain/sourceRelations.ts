import { immutableSourceManifestSchema, snapCutSourceSchema } from './schemas';
import type { ImmutableSourceManifest, SnapCutSource } from './types';

export type ImmutableSourceMetadata = ImmutableSourceManifest;

/**
 * source.json is an immutable import manifest. User-facing name and waveform
 * lifecycle belong only to project.json and can change without media repair.
 */
export function immutableSourceMetadata(sourceInput: SnapCutSource): ImmutableSourceMetadata {
  const source = snapCutSourceSchema.parse(sourceInput) as SnapCutSource;
  const {
    displayName: _displayName,
    waveformFileName: _waveformFileName,
    waveformStatus: _waveformStatus,
    ...immutable
  } = source;
  return immutableSourceManifestSchema.parse(immutable) as ImmutableSourceManifest;
}

export function sourceMetadataMatchesProjectSource(
  sourceFileSource: ImmutableSourceManifest,
  projectSource: SnapCutSource,
): boolean {
  return (
    JSON.stringify(immutableSourceManifestSchema.parse(sourceFileSource)) ===
    JSON.stringify(immutableSourceMetadata(projectSource))
  );
}
