import type { ImmutableSourceManifest, SnapCutSource } from './types';

/**
 * source.json is an immutable import manifest. User-facing name and waveform
 * lifecycle belong only to project.json and can change without media repair.
 */
export function immutableSourceMetadata(sourceInput: SnapCutSource): ImmutableSourceManifest {
  const {
    displayName: _displayName,
    waveformFileName: _waveformFileName,
    waveformStatus: _waveformStatus,
    ...immutable
  } = sourceInput;
  return immutable;
}

export function sourceMetadataMatchesProjectSource(
  sourceFileSource: ImmutableSourceManifest,
  projectSource: SnapCutSource,
): boolean {
  return (
    sourceFileSource.id === projectSource.id &&
    sourceFileSource.originalMimeType === projectSource.originalMimeType &&
    sourceFileSource.sourceKind === projectSource.sourceKind &&
    sourceFileSource.privateAudioFileName === projectSource.privateAudioFileName &&
    sourceFileSource.durationMs === projectSource.durationMs &&
    sourceFileSource.codecMime === projectSource.codecMime &&
    sourceFileSource.sampleRateHz === projectSource.sampleRateHz &&
    sourceFileSource.channelCount === projectSource.channelCount &&
    sourceFileSource.encodedBitrateBps === projectSource.encodedBitrateBps &&
    sourceFileSource.pcmBitsPerSample === projectSource.pcmBitsPerSample &&
    sourceFileSource.fileSizeBytes === projectSource.fileSizeBytes &&
    sourceFileSource.createdAt === projectSource.createdAt &&
    sourceFileSource.aacProfile === projectSource.aacProfile &&
    sourceFileSource.codecConfigFingerprint === projectSource.codecConfigFingerprint &&
    sourceFileSource.encoderDelayFrames === projectSource.encoderDelayFrames &&
    sourceFileSource.encoderPaddingFrames === projectSource.encoderPaddingFrames &&
    sourceFileSource.privateAudioSha256 === projectSource.privateAudioSha256
  );
}
