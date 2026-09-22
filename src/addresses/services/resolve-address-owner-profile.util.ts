import { ProfilesRepository } from '../../profiles/profiles.repository';
import { addressOwnerProfileNotFound } from '../errors/address-owner-profile-not-found.error';
import { AddressOwnerRole } from '../models/address-owner-role.enum';

/**
 * Resolves the caller's own `CustomerProfile.id`/`ProfessionalProfile.id`
 * for an EXPLICITLY client-supplied `ownerRole` — used by
 * `AddAddressService`/`ListMyAddressesService`, the only two operations
 * that accept `ownerRole` as an argument at all (see `AddAddressInput`'s
 * own header comment for why). Throws `addressOwnerProfileNotFound()` if
 * the caller does not hold a profile of that type.
 */
export async function resolveAddressOwnerProfileId(
  profilesRepository: ProfilesRepository,
  userId: string,
  ownerRole: AddressOwnerRole,
): Promise<string> {
  if (ownerRole === AddressOwnerRole.CUSTOMER) {
    const profile =
      await profilesRepository.findCustomerProfileByUserId(userId);
    if (!profile) {
      throw addressOwnerProfileNotFound();
    }
    return profile.id;
  }

  const profile =
    await profilesRepository.findProfessionalProfileByUserId(userId);
  if (!profile) {
    throw addressOwnerProfileNotFound();
  }
  return profile.id;
}

/**
 * Resolves BOTH of the caller's own profile ids (each `null` when they
 * don't hold that profile type) — used by `UpdateAddressService`/
 * `DeleteAddressService`/`SetDefaultAddressService`, none of which accept a
 * client-supplied `ownerRole`: an existing `Address`'s own `ownerRole` is
 * never trusted from the client, only resolved by checking it against
 * whichever of the caller's own profiles actually owns it (see
 * `AddressesRepository.findOneOwnedByEitherProfile`).
 */
export async function resolveCallerOwnedProfileIds(
  profilesRepository: ProfilesRepository,
  userId: string,
): Promise<{
  customerProfileId: string | null;
  professionalProfileId: string | null;
}> {
  const [customerProfile, professionalProfile] = await Promise.all([
    profilesRepository.findCustomerProfileByUserId(userId),
    profilesRepository.findProfessionalProfileByUserId(userId),
  ]);
  return {
    customerProfileId: customerProfile?.id ?? null,
    professionalProfileId: professionalProfile?.id ?? null,
  };
}
