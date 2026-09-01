/**
 * Cross-boundary READ-ONLY port — the only way any sender adapter
 * (`EmailQueueVerificationCodeSenderAdapter`/
 * `EmailQueuePasswordResetEmailSenderAdapter`/
 * `EmailQueueAdminInviteEmailSenderAdapter`) reaches the admin-editable
 * `EmailTemplate` content. Mirrors `PlatformSettingPort`'s own
 * cross-boundary-port shape exactly. Any consumer module may reach this
 * port via `EmailModule` (which imports+re-exports the resolver-free
 * `EmailTemplatesModule` — see that module's own header comment); no
 * consumer ever reaches `EmailTemplatesRepository`/Prisma directly.
 */
export abstract class EmailTemplatePort {
  /**
   * Returns the current `subject`/`htmlBody`/`textBody` for `key`, or `null`
   * if no row exists yet (an unseeded environment, or the row was somehow
   * removed outside the normal update path — see this feature's own
   * fail-closed convention: every caller MUST treat `null` as "not
   * configured" and throw `emailTemplateNotConfigured(key)`
   * (`src/email/errors/email-template-not-configured.error.ts`), never
   * silently send a broken/empty email).
   */
  abstract getByKey(
    key: string,
  ): Promise<{ subject: string; htmlBody: string; textBody: string } | null>;
}
