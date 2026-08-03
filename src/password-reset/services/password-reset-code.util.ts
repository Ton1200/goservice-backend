import { createHash, randomInt } from 'crypto';

const CODE_DIGITS = 6;
const CODE_UPPER_BOUND = 1_000_000; // 10^6, matches CODE_DIGITS

/**
 * Generates a cryptographically-secure 6-digit numeric password-reset code
 * (`crypto.randomInt`, NOT `Math.random`) plus its SHA-256 hash for at-rest
 * storage. This is a deliberate structural mirror of
 * `src/users/services/verification-code.util.ts` — GOS-9's plan
 * (`goservice-backend/docs/gos9-plan-tecnico.md` §4, "Decisiones
 * pendientes" #6) flagged extracting a single shared util as a possible
 * follow-up refactor, but that extraction was NOT one of the decisions
 * resolved before this implementation, so `PasswordResetCode` gets its own
 * copy rather than a silent cross-module refactor of GOS-22's code.
 *
 * SHA-256, not argon2 — same rationale as the mirrored util: the real
 * controls on a 6-digit space are `attemptsCount` + expiry + throttling, so
 * a slow KDF adds latency without a real security benefit here.
 */
export function generatePasswordResetCode(): {
  code: string;
  codeHash: string;
} {
  const code = randomInt(0, CODE_UPPER_BOUND)
    .toString()
    .padStart(CODE_DIGITS, '0');
  return { code, codeHash: hashPasswordResetCode(code) };
}

export function hashPasswordResetCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
