/**
 * Abstraction over delivering a verification code to a user. Real email
 * delivery is explicitly out of scope for GOS-22 — the only implementation
 * (`adapters/logging-verification-code-sender.adapter.ts`) is a stub that
 * logs an event/outcome only, never the plaintext code or raw email.
 */
export abstract class VerificationCodeSenderPort {
  abstract sendVerificationCode(email: string, code: string): Promise<void>;
}
