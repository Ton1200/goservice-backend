import { Injectable } from '@nestjs/common';
import { EmailTemplatePort } from '../../platform-admin/email-templates/ports/email-template.port';
import { EmailLayoutPort } from '../../platform-admin/email-templates/ports/email-layout.port';
import { emailTemplateNotConfigured } from '../errors/email-template-not-configured.error';
import { emailLayoutNotConfigured } from '../errors/email-layout-not-configured.error';
import {
  RenderedEmail,
  renderEmailTemplate,
  substitute,
} from './render-email-template.util';

/**
 * Shared header/footer follow-up (2026-08-25) — the ONE place an
 * `EmailTemplate` row and the shared `EmailLayout` row are composed into a
 * final, ready-to-send subject/text/html. Replaces the former pattern where
 * every sender adapter (`EmailQueueVerificationCodeSenderAdapter`/
 * `EmailQueuePasswordResetEmailSenderAdapter`/
 * `EmailQueueAdminInviteEmailSenderAdapter`) and `SendTestEmailTemplateService`
 * each called `EmailTemplatePort.getByKey` + `renderEmailTemplate`
 * independently, with the header/footer HTML hand-embedded ONCE PER ROW
 * inside `EmailTemplate.htmlBody` at seed time (the old `emailLayout()`
 * build-time helper in `prisma/seed.ts`, now deleted) — editing the
 * header/footer used to mean editing all 3 rows separately in the admin
 * panel; now it is a single admin action (`updateEmailLayout`), applied
 * automatically here to every current AND future template.
 *
 * Composition order: `headerHtml` + template body html + `footerHtml` (same
 * for the text variant) — the layout NEVER touches `subject` (a header/
 * footer wrapping the visible body makes no sense prepended/appended to a
 * mail client's subject line).
 *
 * `{{greeting}}` is the one variable value present in `variables` for every
 * current template (`verification_code`/`password_reset_code`/
 * `admin_invite` all resolve it before calling `render()` — see each sender
 * adapter's own header comment) — so it is safe to reference in the shared
 * header/footer text. Any OTHER token (e.g. `{{code}}`) referenced in
 * `headerHtml`/`footerHtml` renders LITERALLY for a template whose
 * `variables` map doesn't define it (`substitute`'s own documented
 * behavior) — the admin panel's layout-editor hint calls this out
 * explicitly.
 *
 * Reuses `substitute` (exported from `render-email-template.util.ts`)
 * directly for the layout halves, rather than reimplementing token
 * substitution a second time — same `{{token}}` regex, same
 * escape-only-for-HTML rule as `renderEmailTemplate` applies to the
 * template body itself.
 *
 * Both `EmailTemplatePort.getByKey`/`EmailLayoutPort.getLayout` returning
 * `null` are fail-closed conditions (an unseeded environment, or a row
 * somehow missing) — this service throws rather than silently sending a
 * broken/incomplete email, same philosophy as every other email-sending
 * gate in this codebase (see `emailTemplateNotConfigured`/
 * `emailLayoutNotConfigured`'s own header comments).
 */
@Injectable()
export class EmailTemplateRenderer {
  constructor(
    private readonly emailTemplatePort: EmailTemplatePort,
    private readonly emailLayoutPort: EmailLayoutPort,
  ) {}

  async render(
    key: string,
    variables: Record<string, string>,
  ): Promise<RenderedEmail> {
    const template = await this.emailTemplatePort.getByKey(key);
    if (!template) {
      throw emailTemplateNotConfigured(key);
    }

    const layout = await this.emailLayoutPort.getLayout();
    if (!layout) {
      throw emailLayoutNotConfigured();
    }

    const body = renderEmailTemplate({ key, ...template }, variables);

    // Uploadable-logo follow-up (2026-08-25) — `logoUrl` is added to a
    // SEPARATE variables map used ONLY for the header/footer halves, never
    // merged into the template body's own `variables` (a template's
    // `htmlBody`/`textBody` has no legitimate reason to reference
    // `{{logoUrl}}` directly — the shared header is the one place a logo
    // belongs). `?? ''` — a `null` `logoUrl` (no logo configured) renders
    // as an empty string rather than the literal `{{logoUrl}}` token,
    // matching `substitute`'s own "known variable, empty value" behavior
    // for every other token here.
    const layoutVariables = { ...variables, logoUrl: layout.logoUrl ?? '' };

    return {
      subject: body.subject,
      html:
        substitute(layout.headerHtml, layoutVariables, true) +
        body.html +
        substitute(layout.footerHtml, layoutVariables, true),
      text:
        substitute(layout.headerText, layoutVariables, false) +
        body.text +
        substitute(layout.footerText, layoutVariables, false),
    };
  }
}
