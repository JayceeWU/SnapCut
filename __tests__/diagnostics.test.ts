import { sanitizeDiagnosticFields } from '@/diagnostics/BoundedDiagnosticLog';

describe('bounded diagnostic privacy', () => {
  it('retains only the explicit non-sensitive field allowlist', () => {
    const unsafe = {
      operation: 'import',
      stage: 'verifying',
      sourceBytes: 123,
      projectId: '11111111-1111-4111-8111-111111111111',
      sourceId: '22222222-2222-4222-8222-222222222222',
      appVersion: '1.0.0',
      androidVersion: 36,
      uri: 'content://provider/private-token',
      fileName: 'private-song.m4a',
      projectName: 'Private project',
    } as never;

    expect(sanitizeDiagnosticFields(unsafe)).toEqual({
      operation: 'import',
      stage: 'verifying',
      sourceBytes: 123,
      projectId: '11111111-1111-4111-8111-111111111111',
      sourceId: '22222222-2222-4222-8222-222222222222',
      appVersion: '1.0.0',
      androidVersion: 36,
    });
  });

  it('drops non-finite and oversized values', () => {
    expect(
      sanitizeDiagnosticFields({
        elapsedMs: Number.NaN,
        status: 'x'.repeat(81),
        available: true,
      }),
    ).toEqual({ available: true });
  });
});
