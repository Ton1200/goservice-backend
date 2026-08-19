import { DomainException } from '../../common/errors/domain-exception';

const SERVICE_REQUEST_NOT_FOUND_CODE = 'SERVICE_REQUEST_NOT_FOUND';

/**
 * Thrown by `CancelServiceRequestService` both when a `ServiceRequest` id
 * does not exist AT ALL and when it exists but belongs to a different
 * `CustomerProfile` — deliberately the SAME code for both cases. A caller
 * who is not the owner must not be able to distinguish "doesn't exist" from
 * "exists but isn't yours" — same anti-enumeration discipline
 * `UNAUTHENTICATED` already applies across missing/expired/revoked
 * sessions.
 */
export function serviceRequestNotFound(): DomainException {
  return new DomainException(
    SERVICE_REQUEST_NOT_FOUND_CODE,
    'ServiceRequest not found.',
  );
}
