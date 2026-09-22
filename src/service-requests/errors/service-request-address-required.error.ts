import { DomainException } from '../../common/errors/domain-exception';

const SERVICE_REQUEST_ADDRESS_REQUIRED_CODE =
  'SERVICE_REQUEST_ADDRESS_REQUIRED';

/**
 * Thrown by `PublishServiceRequestService` when `input.addressId` is
 * omitted AND the caller's own `CustomerProfile` has no `isDefault` Address
 * to fall back to (GOS-155) — a `ServiceRequest` must always be published
 * with a resolved `addressId` so it can later be found by
 * `nearbyServiceRequests`; there is no "publish now, add an Address later"
 * path. The caller must call `addAddress` first (which forces the FIRST
 * Address ever saved for a profile to be `isDefault` — see that model's own
 * schema comment), then retry.
 */
export function serviceRequestAddressRequired(): DomainException {
  return new DomainException(
    SERVICE_REQUEST_ADDRESS_REQUIRED_CODE,
    'Publishing a ServiceRequest requires a saved Address — add one first (addAddress) or pass addressId explicitly.',
  );
}
