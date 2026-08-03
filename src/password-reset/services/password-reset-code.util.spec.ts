import { createHash } from 'crypto';
import {
  generatePasswordResetCode,
  hashPasswordResetCode,
} from './password-reset-code.util';

describe('password-reset-code.util', () => {
  describe('generatePasswordResetCode', () => {
    it('generates a zero-padded 6-digit numeric code', () => {
      for (let i = 0; i < 50; i++) {
        const { code } = generatePasswordResetCode();
        expect(code).toMatch(/^\d{6}$/);
      }
    });

    it('returns a codeHash matching sha256(code)', () => {
      const { code, codeHash } = generatePasswordResetCode();
      expect(codeHash).toBe(createHash('sha256').update(code).digest('hex'));
    });
  });

  describe('hashPasswordResetCode', () => {
    it('is deterministic for the same input', () => {
      expect(hashPasswordResetCode('123456')).toBe(
        hashPasswordResetCode('123456'),
      );
    });

    it('produces different hashes for different codes', () => {
      expect(hashPasswordResetCode('123456')).not.toBe(
        hashPasswordResetCode('654321'),
      );
    });
  });
});
