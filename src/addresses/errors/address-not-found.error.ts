import { DomainException } from '../../common/errors/domain-exception';

const ADDRESS_NOT_FOUND_CODE = 'ADDRESS_NOT_FOUND';

/**
 * Thrown by `UpdateAddressService`/`DeleteAddressService`/
 * `SetDefaultAddressService` when the given `id` does not resolve to an
 * `Address` owned by ANY of the caller's own profiles — deliberately the
 * SAME error whether the row genuinely does not exist or it belongs to a
 * different User's profile, same anti-enumeration idiom as
 * `savedCardNotFound()` (`src/payments/errors/saved-card-not-found.error.ts`):
 * a caller can never learn "that id exists, but isn't yours" from the error
 * alone.
 */
export function addressNotFound(): DomainException {
  return new DomainException(ADDRESS_NOT_FOUND_CODE, 'Address not found.');
}
