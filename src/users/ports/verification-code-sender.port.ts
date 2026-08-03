/**
 * Abstraction over delivering a verification code to a user. Implemented by
 * `adapters/email-queue-verification-code-sender.adapter.ts`, which
 * enqueues a real email (via `EmailModule`/Resend) rather than sending it
 * in-request — see `../../email/email.module.ts`.
 */
export abstract class VerificationCodeSenderPort {
  abstract sendVerificationCode(email: string, code: string): Promise<void>;
}
