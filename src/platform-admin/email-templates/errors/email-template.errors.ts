import { DomainException } from '../../../common/errors/domain-exception';

/**
 * Thrown by `UpdateEmailTemplateService`/`SendTestEmailTemplateService` when
 * `key` is not one of the 3 fixed values in `KNOWN_EMAIL_TEMPLATE_KEYS` —
 * checked BEFORE any DB read/write, same "validate before touching the DB"
 * convention as `SetPlatformSettingService`'s own hard vetoes.
 */
export function unknownEmailTemplateKey(key: string): DomainException {
  return new DomainException(
    'UNKNOWN_EMAIL_TEMPLATE_KEY',
    `"${key}" is not a known email template key.`,
  );
}

/**
 * Thrown by `UpdateEmailTemplateService`/`SendTestEmailTemplateService` when
 * `key` IS one of the 3 known keys, but no `EmailTemplate` row exists for it
 * yet — i.e. `prisma/seed.ts` hasn't run on this environment. Distinct from
 * `unknownEmailTemplateKey` (a real, but unseeded, key) so the admin panel
 * can show a clearer message than "unknown key" for what is really a
 * missing-seed condition.
 */
export function emailTemplateRowNotSeeded(key: string): DomainException {
  return new DomainException(
    'EMAIL_TEMPLATE_ROW_NOT_SEEDED',
    `Email template "${key}" has not been seeded yet on this environment.`,
  );
}
