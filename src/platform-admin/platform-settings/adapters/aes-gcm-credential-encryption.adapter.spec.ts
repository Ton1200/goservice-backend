import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';
import { AesGcmCredentialEncryptionAdapter } from './aes-gcm-credential-encryption.adapter';
import { InvalidCredentialEncryptionKeyError } from '../errors/invalid-credential-encryption-key.error';

describe('AesGcmCredentialEncryptionAdapter', () => {
  function makeAdapter(rawKey: string | undefined) {
    const get = jest.fn().mockReturnValue(rawKey);
    const configService = { get } as unknown as ConfigService<AppConfig, true>;
    return new AesGcmCredentialEncryptionAdapter(configService);
  }

  function validKey(): string {
    return randomBytes(32).toString('base64');
  }

  it('round-trips encrypt/decrypt back to the original plaintext', () => {
    const adapter = makeAdapter(validKey());
    const plaintext = 'super-secret-client-id-value';

    const encrypted = adapter.encrypt(plaintext);
    const decrypted = adapter.decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext/iv for the same plaintext on repeated calls (random IV per encryption)', () => {
    const adapter = makeAdapter(validKey());
    const plaintext = 'same-value-every-time';

    const first = adapter.encrypt(plaintext);
    const second = adapter.encrypt(plaintext);

    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    expect(
      Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext)),
    ).toBe(false);
  });

  it('fails to decrypt with a tampered authTag (authenticity check)', () => {
    const adapter = makeAdapter(validKey());
    const encrypted = adapter.encrypt('some-value');
    const tamperedAuthTag = Buffer.from(encrypted.authTag);
    tamperedAuthTag[0] ^= 0xff;

    expect(() =>
      adapter.decrypt({ ...encrypted, authTag: tamperedAuthTag }),
    ).toThrow();
  });

  describe('maskedPreview', () => {
    it('returns the last 4 characters prefixed with a bullet placeholder for a long value', () => {
      const adapter = makeAdapter(validKey());
      expect(adapter.maskedPreview('a-very-long-client-id-1234')).toBe(
        '•••1234',
      );
    });

    it('returns a fixed placeholder (not any real characters) for a value of length <= 4', () => {
      const adapter = makeAdapter(validKey());
      expect(adapter.maskedPreview('abcd')).toBe('••••');
      expect(adapter.maskedPreview('ab')).toBe('••••');
      expect(adapter.maskedPreview('')).toBe('••••');
    });
  });

  describe('malformed ADMIN_CREDENTIALS_ENCRYPTION_KEY', () => {
    it('throws InvalidCredentialEncryptionKeyError when the env var is unset', () => {
      const adapter = makeAdapter(undefined);
      expect(() => adapter.encrypt('value')).toThrow(
        InvalidCredentialEncryptionKeyError,
      );
    });

    it('throws InvalidCredentialEncryptionKeyError for a non-base64 value', () => {
      const adapter = makeAdapter('not valid base64 !!! ***');
      expect(() => adapter.encrypt('value')).toThrow(
        InvalidCredentialEncryptionKeyError,
      );
    });

    it('throws InvalidCredentialEncryptionKeyError when the decoded key is the wrong length (not 32 bytes)', () => {
      const wrongLengthKey = randomBytes(16).toString('base64'); // 128-bit, not 256-bit
      const adapter = makeAdapter(wrongLengthKey);
      expect(() => adapter.encrypt('value')).toThrow(
        InvalidCredentialEncryptionKeyError,
      );
    });

    it('the error message never contains the malformed raw value', () => {
      const malformed = 'THIS-IS-THE-BAD-VALUE-not-base64!!';
      const adapter = makeAdapter(malformed);
      try {
        adapter.encrypt('value');
        fail('expected encrypt() to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain(malformed);
      }
    });
  });
});
