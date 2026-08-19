import { DomainException } from '../../common/errors/domain-exception';

const CUSTOMER_PROFILE_REQUIRED_CODE = 'CUSTOMER_PROFILE_REQUIRED';

/**
 * Thrown by `PublishServiceRequestService`/`ListMyServiceRequestsService`
 * when the authenticated user has no `CustomerProfile` yet. Should never
 * actually happen once `AccountApprovedGuard` has already confirmed
 * `accountStatus === APPROVED` (reaching `APPROVED` already required at
 * least one profile to exist) — kept as a real, thrown error rather than a
 * silent assumption, same "should never happen, but treated defensively"
 * precedent as `StartIdentityVerificationService`'s country-resolution
 * check.
 */
export function customerProfileRequired(): DomainException {
  return new DomainException(
    CUSTOMER_PROFILE_REQUIRED_CODE,
    'This action requires a CustomerProfile.',
  );
}
