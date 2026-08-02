import { DomainException } from '../../common/errors/domain-exception';

const AUTHENTICATION_FAILED_CODE = 'AUTHENTICATION_FAILED';
const AUTHENTICATION_FAILED_MESSAGE = 'Authentication failed.';

/**
 * The single shared factory `LoginService` and `SocialLoginService` MUST
 * both call for every failure mode (unknown email, wrong password,
 * social-only account attempting a password login, ineligible account
 * status, unknown/unlinked social identity, invalid/expired social token).
 * Centralizing it here — rather than each call site constructing its own
 * `DomainException('AUTHENTICATION_FAILED', 'Authentication failed.')` —
 * guarantees the byte-identical `{ code, message }` result is enforced by
 * construction, not by convention (see the GOS-7 plan's parity test).
 */
export function authenticationFailed(): DomainException {
  return new DomainException(
    AUTHENTICATION_FAILED_CODE,
    AUTHENTICATION_FAILED_MESSAGE,
  );
}
