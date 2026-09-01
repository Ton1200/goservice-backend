/**
 * Abstraction over delivering a verification code to a user. Implemented by
 * `adapters/email-queue-verification-code-sender.adapter.ts`, which
 * enqueues a real email (via `EmailModule`/Resend) rather than sending it
 * in-request — see `../../email/email.module.ts`.
 *
 * `firstName` (editable transactional-email templates follow-up,
 * 2026-08-24): `User.firstName` is nullable — pass `null` through cleanly
 * when absent; the sender adapter resolves the `{{greeting}}` template
 * variable to a generic "Hola," in that case, never the caller's job.
 */
export abstract class VerificationCodeSenderPort {
  abstract sendVerificationCode(
    email: string,
    code: string,
    firstName: string | null,
  ): Promise<void>;
}
