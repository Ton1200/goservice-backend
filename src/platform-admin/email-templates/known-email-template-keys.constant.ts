/**
 * The CLOSED, fixed set of `EmailTemplate.key` values this whole feature
 * ever deals with — see that model's own header comment in
 * `prisma/schema.prisma` for why there is deliberately no
 * `createEmailTemplate`/`deleteEmailTemplate` mutation. Single source of
 * truth, imported by:
 *   - `prisma/seed.ts` (seeds exactly these 3 rows with a hand-written
 *     default HTML design).
 *   - `UpdateEmailTemplateService` (rejects any `key` not in this set,
 *     BEFORE any DB write).
 *   - `SendTestEmailTemplateService` (the sample variable values used to
 *     render a real "send a test email" preview).
 *   - `admin-panel/js/emailTemplates.js` (hardcodes the same 3 Spanish
 *     labels/variable hints directly — see that file's own comment for why
 *     this constant isn't literally shared cross-language).
 */
export const KNOWN_EMAIL_TEMPLATE_KEYS = [
  'verification_code',
  'password_reset_code',
  'admin_invite',
] as const;

export type EmailTemplateKey = (typeof KNOWN_EMAIL_TEMPLATE_KEYS)[number];

export function isKnownEmailTemplateKey(key: string): key is EmailTemplateKey {
  return (KNOWN_EMAIL_TEMPLATE_KEYS as readonly string[]).includes(key);
}

/** Human-readable (Spanish, matching this admin panel's product-facing
 * copy convention — e.g. `prisma/seed.ts`'s own `Category` names) label per
 * key, shown as each template card's title in the admin panel. */
export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  verification_code: 'Verificación de email',
  password_reset_code: 'Restablecer contraseña',
  admin_invite: 'Invitación de administrador',
};

/**
 * Which `{{variableName}}` tokens each template's sender adapter actually
 * populates — shown as a static hint in the admin panel's edit dialog, and
 * used verbatim (as sample values) by `SendTestEmailTemplateService` to
 * render a realistic "send a test email" preview without requiring a real
 * User/AdminUser record to exist.
 */
export const EMAIL_TEMPLATE_SAMPLE_VARIABLES: Record<
  EmailTemplateKey,
  Record<string, string>
> = {
  verification_code: {
    greeting: 'Hola Juana,',
    firstName: 'Juana',
    code: '123456',
    ttlMinutes: '15',
  },
  password_reset_code: {
    greeting: 'Hola Juana,',
    firstName: 'Juana',
    code: '123456',
    ttlMinutes: '15',
  },
  admin_invite: {
    greeting: 'Hola Juana Admin,',
    displayName: 'Juana Admin',
    inviteLink: 'https://admin.example.com/admin?invite=sample-token',
    ttlHours: '72',
  },
};
