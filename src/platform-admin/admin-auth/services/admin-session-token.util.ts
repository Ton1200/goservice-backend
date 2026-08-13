import { createHash, randomBytes } from 'crypto';

const ADMIN_SESSION_TOKEN_BYTES = 32; // 256 bits

/**
 * Admin-session token generate/hash — a deliberate, from-scratch duplicate
 * of `src/auth/services/session-token.util.ts`'s logic (same algorithm:
 * `crypto.randomBytes(32)` base64url, SHA-256 hash-at-rest), NOT an import
 * from it. The platform-admin plan requires ZERO shared code between the
 * consumer session mechanism and the admin one, so `AdminSession.tokenHash`
 * never depends on `src/auth/` at all, even though the two implementations
 * currently look identical — they are free to diverge later (e.g. a
 * different token format for the admin panel) without touching consumer
 * code, and vice versa.
 */
export function generateAdminSessionToken(): string {
  return randomBytes(ADMIN_SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashAdminSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
