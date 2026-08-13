export type DomainErrorCode =
  | 'INVALID_PROJECT_NAME'
  | 'INVALID_EXPORT_NAME'
  | 'DUPLICATE_ID'
  | 'SOURCE_NOT_FOUND'
  | 'CLIP_NOT_FOUND'
  | 'INVALID_CLIP_RANGE'
  | 'MOVE_OUT_OF_BOUNDS'
  | 'EMPTY_COMPOSITION'
  | 'UNSUPPORTED_CHANNEL_COUNT'
  | 'INVALID_SAMPLE_RATE'
  | 'INVALID_TIMESTAMP';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
