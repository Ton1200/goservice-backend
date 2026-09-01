/**
 * Cross-boundary READ-ONLY port — the only way `EmailTemplateRenderer`
 * (`src/email/templates/email-template-renderer.service.ts`) reaches the
 * admin-editable, shared `EmailLayout` header/footer content. Mirrors
 * `EmailTemplatePort`'s own cross-boundary-port shape exactly. Any consumer
 * module may reach this port via `EmailModule` (which imports+re-exports
 * the resolver-free `EmailTemplatesModule` — see that module's own header
 * comment); no consumer ever reaches `EmailLayoutRepository`/Prisma
 * directly.
 */
export abstract class EmailLayoutPort {
  /**
   * Returns the current `headerHtml`/`footerHtml`/`headerText`/`footerText`
   * for the single shared layout, or `null` if no row exists yet (an
   * unseeded environment, or the row was somehow removed outside the normal
   * update path — see this feature's own fail-closed convention:
   * `EmailTemplateRenderer` MUST treat `null` as "not configured" and throw
   * `emailLayoutNotConfigured()`
   * (`src/email/errors/email-layout-not-configured.error.ts`), never
   * silently send an email missing its shared header/footer).
   */
  abstract getLayout(): Promise<{
    headerHtml: string;
    footerHtml: string;
    headerText: string;
    footerText: string;
    /** Uploadable-logo follow-up (2026-08-25) — `null` means "no logo
     * configured" (unseeded/never-customized environment, or an admin
     * explicitly cleared it). `EmailTemplateRenderer` substitutes `''` for
     * this, so `{{logoUrl}}` never breaks rendering when absent. */
    logoUrl: string | null;
  } | null>;
}
