import {
  generateAdminSessionToken,
  hashAdminSessionToken,
} from './admin-session-token.util';

describe('admin-session-token.util', () => {
  it('generates a non-empty, base64url-looking token', () => {
    const token = generateAdminSessionToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a different token on every call', () => {
    const a = generateAdminSessionToken();
    const b = generateAdminSessionToken();
    expect(a).not.toBe(b);
  });

  it('hashes deterministically (same input -> same hash)', () => {
    const token = 'fixed-token-value';
    expect(hashAdminSessionToken(token)).toBe(hashAdminSessionToken(token));
  });

  it('produces a hash that never equals the plaintext token', () => {
    const token = generateAdminSessionToken();
    expect(hashAdminSessionToken(token)).not.toBe(token);
  });

  it('produces different hashes for different tokens', () => {
    const a = generateAdminSessionToken();
    const b = generateAdminSessionToken();
    expect(hashAdminSessionToken(a)).not.toBe(hashAdminSessionToken(b));
  });
});
