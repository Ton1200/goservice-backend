/**
 * Abstraction over delivering an admin-invite link to a newly-invited admin.
 * Implemented by `../adapters/email-queue-admin-invite-email-sender.adapter.ts`,
 * which enqueues a real email (via `EmailModule`/Resend) rather than sending
 * it in-request — mirrors `PasswordResetEmailSenderPort` exactly, including
 * `displayName: string` (editable transactional-email templates follow-up,
 * 2026-08-24 — `AdminUser.displayName` is required/non-null, unlike
 * `User.firstName`, so this parameter is never nullable here).
 */
export abstract class AdminInviteEmailSenderPort {
  abstract sendAdminInvite(
    email: string,
    rawToken: string,
    displayName: string,
  ): Promise<void>;
}
