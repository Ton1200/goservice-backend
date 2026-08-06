import { createHash, randomBytes } from 'crypto';

const SESSION_TOKEN_BYTES = 32; // 256 bits

/**
 * Opaque session token generation/hashing (GOS-7) — mirrors
 * `verification-code.util.ts`'s hash-at-rest pattern for
 * `EmailVerificationCode.codeHash`, now applied to `Session.tokenHash`.
 * The plaintext token (`crypto.randomBytes`, NOT `Math.random`) is
 * returned to the caller exactly once, at session creation, and is never
 * persisted anywhere — only its SHA-256 hash is stored, so a database
 * read/leak alone cannot be replayed as a valid bearer token.
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
