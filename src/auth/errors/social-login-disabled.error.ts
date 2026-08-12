import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';

const SOCIAL_LOGIN_DISABLED_CODE = 'SOCIAL_LOGIN_DISABLED';

const MESSAGE_BY_PROVIDER: Record<SocialProvider, string> = {
  [SocialProvider.GOOGLE]: 'Google sign-in is currently disabled.',
  [SocialProvider.APPLE]: 'Apple sign-in is currently disabled.',
};

/**
 * Thrown by `SocialLoginService` when the `social-login.<provider>` feature
 * flag (`FeatureFlagPort`) is disabled — a deliberate, DISTINCT error from
 * the anti-enumeration `authenticationFailed()` result: GOS-32's own
 * acceptance criterion requires this NOT be swallowed into a generic
 * "authentication failed", since an admin-driven outage/toggle is a
 * different, legitimate-to-disclose condition (not a credential-guessing
 * signal).
 */
export function socialLoginDisabled(provider: SocialProvider): DomainException {
  return new DomainException(
    SOCIAL_LOGIN_DISABLED_CODE,
    MESSAGE_BY_PROVIDER[provider],
  );
}
