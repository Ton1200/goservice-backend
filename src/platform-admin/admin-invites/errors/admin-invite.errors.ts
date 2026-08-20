import { DomainException } from '../../../common/errors/domain-exception';

/**
 * The SOLE failure code `acceptAdminInvite` ever returns — mirrors
 * `resetPassword`'s `RESET_CODE_INVALID_OR_EXPIRED` anti-enumeration
 * precedent EXACTLY: every distinct failure mode (token doesn't exist,
 * already expired, already consumed, already invalidated) collapses into
 * this ONE generic result. `acceptAdminInvite` is the only mutation in this
 * entire feature reachable without any authentication — there is no
 * legitimate reason for an unauthenticated caller to be able to distinguish
 * these cases from each other.
 */
export function adminInviteTokenInvalidOrExpired(): DomainException {
  return new DomainException(
    'ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED',
    'This invite link is invalid or has expired.',
  );
}
