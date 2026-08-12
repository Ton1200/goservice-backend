import { DomainException } from '../../../common/errors/domain-exception';

const ADMIN_AUTHENTICATION_FAILED_CODE = 'ADMIN_AUTHENTICATION_FAILED';
const ADMIN_AUTHENTICATION_FAILED_MESSAGE = 'Admin authentication failed.';

/**
 * The single shared factory `AdminLoginService` MUST call for every
 * `adminLogin` failure mode (unknown email, wrong password, an
 * `INVITED`/`REVOKED` account) — same anti-enumeration principle as
 * `src/auth/errors/authentication-failed.error.ts`'s `authenticationFailed()`,
 * deliberately a DIFFERENT `code` (`ADMIN_AUTHENTICATION_FAILED`, not
 * `AUTHENTICATION_FAILED`) so the two schemas' error vocabularies never
 * accidentally cross-match.
 */
export function adminAuthenticationFailed(): DomainException {
  return new DomainException(
    ADMIN_AUTHENTICATION_FAILED_CODE,
    ADMIN_AUTHENTICATION_FAILED_MESSAGE,
  );
}
