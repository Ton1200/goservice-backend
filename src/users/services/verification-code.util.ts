import { createHash, randomInt } from 'crypto';

const CODE_DIGITS = 6;
const CODE_UPPER_BOUND = 1_000_000; // 10^6, matches CODE_DIGITS

/**
 * Generates a cryptographically-secure 6-digit numeric verification code
 * (`crypto.randomInt`, NOT `Math.random`) plus its SHA-256 hash for
 * at-rest storage. SHA-256, not argon2 — see
 * `prisma/schema.prisma`'s `EmailVerificationCode.codeHash` comment: the
 * real controls on a 6-digit space are `attemptsCount` + expiry +
 * throttling, so a slow KDF adds latency without a real security benefit
 * here. Shared by `RegisterUserService` and `ResendVerificationCodeService`
 * so the generation/hashing rule has exactly one implementation.
 */
export function generateVerificationCode(): {
  code: string;
  codeHash: string;
} {
  const code = randomInt(0, CODE_UPPER_BOUND)
    .toString()
    .padStart(CODE_DIGITS, '0');
  return { code, codeHash: hashVerificationCode(code) };
}

export function hashVerificationCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
