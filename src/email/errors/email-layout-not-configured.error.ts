import { DomainException } from '../../common/errors/domain-exception';

const EMAIL_LAYOUT_NOT_CONFIGURED_CODE = 'EMAIL_LAYOUT_NOT_CONFIGURED';

/**
 * Thrown by `EmailTemplateRenderer.render()` when `EmailLayoutPort.getLayout()`
 * returns `null` — i.e. `prisma/seed.ts` hasn't run yet on this environment,
 * or the single `EmailLayout` row was somehow deleted outside the normal
 * `updateEmailLayout` mutation (which only ever UPSERTS the one `'singleton'`
 * row — see `EmailLayout`'s own header comment in `prisma/schema.prisma`).
 *
 * Mirrors `emailTemplateNotConfigured()`'s exact shape and fail-closed
 * philosophy: never silently send an email missing its shared header/footer
 * — fail loudly instead, with a code distinct from
 * `EMAIL_TEMPLATE_NOT_CONFIGURED` (this is a layout-configuration problem,
 * not a per-template one — the two are checked independently by
 * `EmailTemplateRenderer` and can fail for different reasons).
 */
export function emailLayoutNotConfigured(): DomainException {
  return new DomainException(
    EMAIL_LAYOUT_NOT_CONFIGURED_CODE,
    'The shared email header/footer layout is not configured yet.',
  );
}
