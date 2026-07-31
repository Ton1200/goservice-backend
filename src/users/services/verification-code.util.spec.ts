import { createHash } from 'crypto';
import {
  generateVerificationCode,
  hashVerificationCode,
} from './verification-code.util';

describe('verification-code.util', () => {
  describe('generateVerificationCode', () => {
    it('generates a zero-padded 6-digit numeric code', () => {
      for (let i = 0; i < 50; i++) {
        const { code } = generateVerificationCode();
        expect(code).toMatch(/^\d{6}$/);
      }
    });

    it('returns a codeHash matching sha256(code)', () => {
      const { code, codeHash } = generateVerificationCode();
      expect(codeHash).toBe(createHash('sha256').update(code).digest('hex'));
    });
  });

  describe('hashVerificationCode', () => {
    it('is deterministic for the same input', () => {
      expect(hashVerificationCode('123456')).toBe(
        hashVerificationCode('123456'),
      );
    });

    it('produces different hashes for different codes', () => {
      expect(hashVerificationCode('123456')).not.toBe(
        hashVerificationCode('654321'),
      );
    });
  });
});
