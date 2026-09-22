import { DomainException } from '../../common/errors/domain-exception';

const DEFAULT_ADDRESS_DELETE_BLOCKED_CODE = 'DEFAULT_ADDRESS_DELETE_BLOCKED';

/**
 * Thrown by `DeleteAddressService` when the target `Address` is the owning
 * profile's current default AND at least one other `Address` still exists
 * for that same profile — a profile with more than one saved Address may
 * never be left without a default. The caller must call
 * `setDefaultAddress` on a different `Address` first. Does NOT apply when
 * the target is the profile's ONLY `Address` (default or not) — deleting
 * the last one is always allowed, leaving the profile with zero Addresses
 * (no default is required at zero).
 */
export function defaultAddressDeleteBlocked(): DomainException {
  return new DomainException(
    DEFAULT_ADDRESS_DELETE_BLOCKED_CODE,
    'Cannot delete the default address while other addresses exist — set a different one as default first.',
  );
}
