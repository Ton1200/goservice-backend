import { DomainException } from '../../common/errors/domain-exception';

const SERVICE_REQUEST_ALREADY_CANCELLED_CODE =
  'SERVICE_REQUEST_ALREADY_CANCELLED';

/**
 * Thrown by `CancelServiceRequestService` when the caller (already
 * confirmed to be the owner — see `serviceRequestNotFound`) tries to cancel
 * a `ServiceRequest` that is already `CANCELLED`. Deliberately a distinct,
 * disclosable code — unlike `SERVICE_REQUEST_NOT_FOUND`, there is no
 * enumeration risk here: the caller already knows this is their own
 * resource, so its current state is safe to report plainly. See the GOS-38
 * plan's "Cancelación repetida" decision for why this rejects instead of a
 * silent no-op.
 */
export function serviceRequestAlreadyCancelled(): DomainException {
  return new DomainException(
    SERVICE_REQUEST_ALREADY_CANCELLED_CODE,
    'This ServiceRequest is already cancelled.',
  );
}
