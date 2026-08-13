import { DomainException } from '../../common/errors/domain-exception';

const EMAIL_DELIVERY_MISCONFIGURED_CODE = 'EMAIL_DELIVERY_MISCONFIGURED';

/**
 * Thrown by `EnsureEmailDeliveryAvailableService` (and, as defense-in-depth,
 * `ResendEmailClientAdapter` itself) when a provider's `enabled`
 * `PlatformSetting` resolves to `'true'` but its `api-key`/`from-address`
 * has never been configured (a fresh install, or an admin flipped the flag
 * on before entering the real credential) — mirrors
 * `socialLoginMisconfigured()`'s exact pattern
 * (`../../auth/errors/social-login-misconfigured.error.ts`).
 *
 * Deliberately DISTINCT from both `EMAIL_DELIVERY_DISABLED` (nobody turned
 * any provider on at all) and any per-account result — same GLOBAL,
 * safe-to-disclose, safe-to-check-first reasoning as that error's own doc
 * comment: a server-misconfiguration condition, not a credential-guessing
 * signal, fail-closed per this codebase's philosophy of never silently
 * proceeding with a missing credential.
 */
export function emailDeliveryMisconfigured(): DomainException {
  return new DomainException(
    EMAIL_DELIVERY_MISCONFIGURED_CODE,
    'Email delivery is not fully configured yet.',
  );
}
