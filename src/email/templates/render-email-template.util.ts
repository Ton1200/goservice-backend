export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * The row shape this util reads from — deliberately a small, structural
 * subset of the `EmailTemplate` Prisma model (not the full row) so this
 * function has zero dependency on `@prisma/client`, matching this
 * codebase's general preference for keeping pure business logic
 * framework/ORM-independent where practical.
 */
export interface EmailTemplateRow {
  key: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

/**
 * Escapes the 5 characters that matter for safe interpolation into HTML
 * markup (`&`, `<`, `>`, `"`, `'`) — a small, local helper rather than a new
 * npm dependency, mirroring this codebase's general "no dependency for
 * something this small" posture (see e.g. `RegexPhoneNumberValidatorAdapter`
 * for the same kind of hand-rolled-over-a-library choice).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TOKEN_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Replaces every `{{variableName}}` token found in `text` with the matching
 * entry from `variables`, HTML-escaping the substituted value only when
 * `escapeValues` is true. A token with no matching entry in `variables` is
 * left LITERAL (`{{unknown}}` stays in the output verbatim) rather than
 * being blanked out — a typo'd/removed variable name should be visibly
 * obvious to whoever is reading the rendered email, not silently erased.
 *
 * EXPORTED (shared header/footer follow-up, 2026-08-25) — `escapeHtml` stays
 * private (an internal implementation detail of substitution), but
 * `substitute` itself is the right seam: `EmailTemplateRenderer`
 * (`email-template-renderer.service.ts`) reuses this EXACT function to
 * interpolate the same `{{variableName}}` tokens into the shared
 * `EmailLayout`'s `headerHtml`/`footerHtml`/`headerText`/`footerText`, so
 * there is exactly one substitution implementation for the whole email
 * pipeline (template body AND layout), never two that could drift.
 */
export function substitute(
  text: string,
  variables: Record<string, string>,
  escapeValues: boolean,
): string {
  return text.replace(TOKEN_PATTERN, (fullMatch, variableName: string) => {
    if (!(variableName in variables)) {
      return fullMatch;
    }
    const value = variables[variableName];
    return escapeValues ? escapeHtml(value) : value;
  });
}

/**
 * Renders an `EmailTemplate` row (admin-editable subject/HTML body/text
 * body, stored as plain text — never a template engine or JSX at runtime)
 * against a `variables` map, via simple `{{variableName}}` token
 * substitution. This is the ONE place this substitution happens, called
 * identically by every sender adapter (`EmailQueueVerificationCodeSenderAdapter`,
 * `EmailQueuePasswordResetEmailSenderAdapter`,
 * `EmailQueueAdminInviteEmailSenderAdapter`) — see each adapter's own header
 * comment.
 *
 * HTML-escaping is applied ONLY when substituting into `htmlBody` — never
 * into `subject`/`textBody`, where escaping would corrupt otherwise-plain
 * text (e.g. an escaped `&amp;` literally appearing in a plain-text email or
 * a mail client's subject line). This matters because every variable value
 * passed in here ultimately originates from user-controlled data (a User's
 * `firstName`, an AdminUser's `displayName`) — without this, a first name
 * like `<script>alert(1)</script>` would be interpolated verbatim into the
 * HTML body an email client renders.
 */
export function renderEmailTemplate(
  row: EmailTemplateRow,
  variables: Record<string, string>,
): RenderedEmail {
  return {
    subject: substitute(row.subject, variables, false),
    text: substitute(row.textBody, variables, false),
    html: substitute(row.htmlBody, variables, true),
  };
}
