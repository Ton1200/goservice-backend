import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';

const SOCIAL_LOGIN_MISCONFIGURED_CODE = 'SOCIAL_LOGIN_MISCONFIGURED';

const MESSAGE_BY_PROVIDER: Record<SocialProvider, string> = {
  [SocialProvider.GOOGLE]: 'Google sign-in is not fully configured yet.',
  [SocialProvider.APPLE]: 'Apple sign-in is not fully configured yet.',
};

/**
 * Thrown by `JoseSocialIdentityValidationAdapter` when the provider's
 * FEATURE FLAG is enabled but its `PlatformCredential`
 * (`customer.social-login.<provider>.client-id`) has never been configured
 * in the admin panel — a fresh install, or an admin turned the flag on
 * before setting the credential. Deliberately DISTINCT from both
 * `SOCIAL_LOGIN_DISABLED` (an admin explicitly turned the provider off —
 * see `social-login-disabled.error.ts`) and the generic, anti-enumeration
 * `AUTHENTICATION_FAILED` (a real token/account-level failure): this is a
 * server-misconfiguration condition, safe and useful to disclose distinctly
 * so an operator can tell "nobody configured this yet" apart from "this
 * specific login attempt failed" — fail-closed per GOS-30's own philosophy
 * (real backend enforcement, clear errors, no silent guessing) rather than
 * quietly falling back to some default audience.
 */
export function socialLoginMisconfigured(
  provider: SocialProvider,
): DomainException {
  return new DomainException(
    SOCIAL_LOGIN_MISCONFIGURED_CODE,
    MESSAGE_BY_PROVIDER[provider],
  );
}
