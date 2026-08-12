import { DomainException } from '../../common/errors/domain-exception';

const EMAIL_DELIVERY_DISABLED_CODE = 'EMAIL_DELIVERY_DISABLED';

/**
 * Thrown by `EnsureEmailDeliveryAvailableService` when NO email provider's
 * `<provider>.enabled` `PlatformSetting` currently resolves to the literal
 * string `'true'` (missing row, or any other value) — mirrors
 * `socialLoginDisabled()`'s exact pattern
 * (`../../auth/errors/social-login-disabled.error.ts`): a deliberate,
 * DISTINCT error from any per-account/anti-enumeration result, thrown
 * BEFORE any account/DB lookup runs.
 *
 * This is a GLOBAL, system-wide condition (no provider is turned on at
 * all, for anyone), never a per-account one — so it is both safe to
 * disclose distinctly AND safe to check FIRST, ahead of any per-account
 * work, in every caller (`RegisterUserService`, `ResendVerificationCodeService`,
 * `RequestPasswordResetService`). Every caller gets this identical error
 * regardless of which email/account is involved, so it cannot be used to
 * enumerate accounts — see `RequestPasswordResetService`'s own
 * anti-enumeration doc comment, and its spec's dedicated test proving an
 * unknown email behaves identically to a real one when this fires.
 */
export function emailDeliveryDisabled(): DomainException {
  return new DomainException(
    EMAIL_DELIVERY_DISABLED_CODE,
    'Email delivery is currently disabled.',
  );
}
