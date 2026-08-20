import { createHash, randomBytes } from 'crypto';

const ADMIN_INVITE_TOKEN_BYTES = 32; // 256 bits

/**
 * Admin-invite token generate/hash — a deliberate, from-scratch duplicate of
 * `../../admin-auth/services/admin-session-token.util.ts`'s logic (same
 * algorithm: `crypto.randomBytes(32)` base64url, SHA-256 hash-at-rest), NOT
 * an import from it — same "zero shared code between independent token
 * mechanisms" isolation posture that file's own header comment already
 * establishes between the admin-session and consumer-session mechanisms,
 * applied here a third time. OPAQUE TOKEN, not a 6-digit code (unlike
 * `PasswordResetCode`/`EmailVerificationCode`): this is delivered by LINK to
 * someone not yet authenticated in any client, so a typed code makes no
 * sense here.
 */
export function generateAdminInviteToken(): string {
  return randomBytes(ADMIN_INVITE_TOKEN_BYTES).toString('base64url');
}

export function hashAdminInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
