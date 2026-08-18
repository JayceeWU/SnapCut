import { describe, expect, jest, test } from '@jest/globals';

import { NativePrivateMediaVerifier } from '@/services/NativePrivateMediaVerifier';

describe('NativePrivateMediaVerifier', () => {
  test('passes only the private file URI and returns actual native facts', async () => {
    const verifyPrivateMedia = jest.fn(async () => ({
      fileSizeBytes: 123,
      sha256: 'a'.repeat(64),
    }));
    const verifier = new NativePrivateMediaVerifier({ verifyPrivateMedia });
    const fileUri = 'file:///private/project/source.m4a';

    await expect(verifier.verifyPrivateMedia(fileUri)).resolves.toEqual({
      fileSizeBytes: 123,
      sha256: 'a'.repeat(64),
    });
    expect(verifyPrivateMedia).toHaveBeenCalledWith({ fileUri });
  });
});
