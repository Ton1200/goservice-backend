import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';
import {
  CredentialEncryptionPort,
  EncryptedCredential,
} from '../ports/credential-encryption.port';
import { InvalidCredentialEncryptionKeyError } from '../errors/invalid-credential-encryption-key.error';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32; // AES-256
// 96-bit IV — the size GCM is designed for and NIST recommends; a longer IV
// is accepted by Node's crypto module but needlessly deviates from the
// standard, well-analyzed case.
const IV_LENGTH_BYTES = 12;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Masked-preview format: the last 4 characters of the trimmed plaintext,
 * prefixed with a bullet placeholder (e.g. "•••1234"). Values of length <=4
 * use a fixed, uninformative placeholder instead — revealing "all but
 * nothing" of a 3-character secret is not meaningfully different from
 * revealing all of it.
 */
const PREVIEW_SUFFIX_LENGTH = 4;
const SHORT_VALUE_PLACEHOLDER = '••••';

/**
 * AES-256-GCM implementation of `CredentialEncryptionPort`. The key is read
 * from `ADMIN_CREDENTIALS_ENCRYPTION_KEY` (see `configuration.ts`) LAZILY —
 * only the first time `encrypt`/`decrypt`/`maskedPreview` is actually
 * called, never at construction/app-startup — so every environment that
 * never touches a `PlatformCredential` boots fine without this var set (see
 * `env-validation.schema.ts`'s comment on the same var). Once successfully
 * read and validated, the decoded key `Buffer` is cached for the lifetime
 * of this (singleton) provider instance — re-reading/re-decoding it on
 * every call would be pure overhead with no benefit, since the env var
 * cannot change without a process restart anyway.
 *
 * Format: `ADMIN_CREDENTIALS_ENCRYPTION_KEY` MUST be a base64-encoded
 * 256-bit (32-byte) key. Any other shape (unset, empty, not valid base64,
 * wrong decoded length) throws `InvalidCredentialEncryptionKeyError` — a
 * clear, actionable message that NEVER includes the actual (invalid) value.
 *
 * Never logs plaintext, ciphertext, or the key anywhere, including in error
 * paths — Node's `crypto` module itself throws on a bad auth tag
 * (tampered/corrupted ciphertext) with a generic message that contains no
 * key/plaintext material, so no extra care is needed there beyond not
 * catching-and-rewrapping it with more detail.
 */
@Injectable()
export class AesGcmCredentialEncryptionAdapter implements CredentialEncryptionPort {
  private cachedKey: Buffer | undefined;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  encrypt(plaintext: string): EncryptedCredential {
    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag };
  }

  decrypt(encrypted: EncryptedCredential): string {
    const key = this.getKey();
    const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv);
    decipher.setAuthTag(encrypted.authTag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  maskedPreview(plaintext: string): string {
    const trimmed = plaintext.trim();
    if (trimmed.length <= PREVIEW_SUFFIX_LENGTH) {
      return SHORT_VALUE_PLACEHOLDER;
    }
    return `•••${trimmed.slice(-PREVIEW_SUFFIX_LENGTH)}`;
  }

  private getKey(): Buffer {
    if (this.cachedKey) {
      return this.cachedKey;
    }

    const raw = this.configService.get('adminCredentialsEncryptionKey', {
      infer: true,
    });
    if (!raw || !BASE64_PATTERN.test(raw)) {
      throw new InvalidCredentialEncryptionKeyError();
    }

    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== KEY_LENGTH_BYTES) {
      throw new InvalidCredentialEncryptionKeyError();
    }

    this.cachedKey = decoded;
    return decoded;
  }
}
