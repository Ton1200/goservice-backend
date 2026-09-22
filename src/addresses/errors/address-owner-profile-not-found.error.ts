import { DomainException } from '../../common/errors/domain-exception';

const ADDRESS_OWNER_PROFILE_NOT_FOUND_CODE = 'ADDRESS_OWNER_PROFILE_NOT_FOUND';

/**
 * Thrown by `AddAddressService`/`ListMyAddressesService` when the caller
 * does not hold a `CustomerProfile`/`ProfessionalProfile` matching the
 * `ownerRole` they explicitly asked to act as (e.g. a User with only a
 * `CustomerProfile` calling `addAddress(ownerRole: PROFESSIONAL, ...)`).
 * `ownerRole` is the one input field this capability accepts from the
 * client without deriving it server-side — see `AddAddressInput`'s own
 * header comment for why — so this is a genuine "you don't hold that role"
 * rejection, not an anti-enumeration concern the way `addressNotFound()`
 * is for an EXISTING resource.
 */
export function addressOwnerProfileNotFound(): DomainException {
  return new DomainException(
    ADDRESS_OWNER_PROFILE_NOT_FOUND_CODE,
    'You do not have a profile matching the requested ownerRole.',
  );
}
