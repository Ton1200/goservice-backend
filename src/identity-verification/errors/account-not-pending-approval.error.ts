import { DomainException } from '../../common/errors/domain-exception';

const ACCOUNT_NOT_PENDING_APPROVAL_CODE = 'ACCOUNT_NOT_PENDING_APPROVAL';

/**
 * Thrown by `StartIdentityVerificationService` when the authenticated
 * caller's `User.accountStatus` is not `PENDING_APPROVAL` — e.g. they
 * haven't verified their email yet, haven't created a profile yet, are
 * already `APPROVED`/`REJECTED`, or have re-submitted while a prior
 * verification attempt is still `PENDING`. Deliberately a distinct,
 * disclosed error (not folded into a generic failure) — this is the
 * caller's OWN account state, resolved server-side from their own session,
 * never information about anyone else's account, so there is no
 * enumeration risk in disclosing it plainly (unlike `AUTHENTICATION_FAILED`
 * during login, which is about a DIFFERENT, possibly-unauthenticated
 * party's account).
 */
export function accountNotPendingApproval(): DomainException {
  return new DomainException(
    ACCOUNT_NOT_PENDING_APPROVAL_CODE,
    'Identity verification can only be started while your account is pending approval.',
  );
}
