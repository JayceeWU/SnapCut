import SnapCutMedia from '@/native/SnapCutMedia';
import type { SnapCutMediaApi } from '@/native/SnapCutMedia.types';
import type {
  PrivateMediaVerification,
  PrivateMediaVerifier,
} from '@/repositories/ImportTransaction';

/** Production adapter; media bytes and hashing remain entirely in the native layer. */
export class NativePrivateMediaVerifier implements PrivateMediaVerifier {
  constructor(private readonly media: Pick<SnapCutMediaApi, 'verifyPrivateMedia'> = SnapCutMedia) {}

  async verifyPrivateMedia(fileUri: string): Promise<PrivateMediaVerification> {
    return this.media.verifyPrivateMedia({ fileUri });
  }
}

export const nativePrivateMediaVerifier = new NativePrivateMediaVerifier();
