import { DomainException } from '../../common/errors/domain-exception';

const SERVICE_REQUEST_HAS_ENGAGEMENT_CODE = 'SERVICE_REQUEST_HAS_ENGAGEMENT';

/**
 * Thrown by `CancelServiceRequestService` (GOS-41) when the caller (already
 * confirmed to be the owner — see `serviceRequestNotFound`) tries to cancel
 * a `ServiceRequest` that is `ENGAGED` — an active `Engagement` already
 * exists for it (a Quote was accepted). Deliberately a distinct,
 * disclosable code, same reasoning as `serviceRequestAlreadyCancelled()`:
 * no enumeration risk, the caller already knows this is their own resource.
 * A `ServiceRequest` must NEVER end up both `CANCELLED` and carrying an
 * active `Engagement` at the same time — this error, together with the
 * guarded `updateMany` CAS in `ServiceRequestsRepository.cancel()`, is what
 * makes that guarantee real even under a cancel-vs-accept race (see that
 * repository method's own comment).
 */
export function serviceRequestHasEngagement(): DomainException {
  return new DomainException(
    SERVICE_REQUEST_HAS_ENGAGEMENT_CODE,
    'This ServiceRequest already has an active Engagement and cannot be cancelled.',
  );
}
