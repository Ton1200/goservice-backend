import { DomainException } from '../../common/errors/domain-exception';

const ACCOUNT_NOT_APPROVED_CODE = 'ACCOUNT_NOT_APPROVED';

/**
 * Thrown by `AccountApprovedGuard` when the authenticated caller's
 * `User.accountStatus` is anything other than `APPROVED` — deliberately
 * distinct from `SessionGuard`'s `UNAUTHENTICATED` (which means "we don't
 * know who you are"): this means "we know who you are, but your account
 * hasn't cleared approval yet". Mirrors `ADMIN_FORBIDDEN`'s exact reasoning
 * (`AdminPermissionsGuard`) — an authenticated-but-not-yet-approved caller
 * needs a UI that can tell the two apart.
 */
export function accountNotApproved(): DomainException {
  return new DomainException(
    ACCOUNT_NOT_APPROVED_CODE,
    'This action requires an approved account.',
  );
}
