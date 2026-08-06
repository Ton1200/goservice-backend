import { createHash } from 'crypto';
import { generateSessionToken, hashSessionToken } from './session-token.util';

describe('session-token.util', () => {
  describe('generateSessionToken', () => {
    it('generates a base64url token with sufficient entropy, never repeating', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const token = generateSessionToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(token.length).toBeGreaterThanOrEqual(40); // 32 bytes, base64url
        tokens.add(token);
      }
      expect(tokens.size).toBe(50);
    });
  });

  describe('hashSessionToken', () => {
    it('is deterministic for the same input', () => {
      const token = generateSessionToken();
      expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    });

    it('matches the sha256 hex digest of the token', () => {
      const token = generateSessionToken();
      expect(hashSessionToken(token)).toBe(
        createHash('sha256').update(token).digest('hex'),
      );
    });

    it('produces different hashes for different tokens', () => {
      expect(hashSessionToken(generateSessionToken())).not.toBe(
        hashSessionToken(generateSessionToken()),
      );
    });
  });
});
