/**
 * Abstraction over delivering a password-reset code to a user. Implemented
 * by `adapters/email-queue-password-reset-email-sender.adapter.ts`, which
 * enqueues a real email (via `EmailModule`/Resend) rather than sending it
 * in-request — mirrors
 * `src/users/ports/verification-code-sender.port.ts` exactly, including its
 * `firstName: string | null` parameter (editable transactional-email
 * templates follow-up, 2026-08-24).
 */
export abstract class PasswordResetEmailSenderPort {
  abstract sendPasswordResetCode(
    email: string,
    code: string,
    firstName: string | null,
  ): Promise<void>;
}
