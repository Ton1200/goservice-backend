/**
 * Abstraction over delivering an admin-invite link to a newly-invited admin.
 * Implemented by `../adapters/email-queue-admin-invite-email-sender.adapter.ts`,
 * which enqueues a real email (via `EmailModule`/Resend) rather than sending
 * it in-request — mirrors `PasswordResetEmailSenderPort` exactly.
 */
export abstract class AdminInviteEmailSenderPort {
  abstract sendAdminInvite(email: string, rawToken: string): Promise<void>;
}
