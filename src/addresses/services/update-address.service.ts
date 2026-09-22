import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { addressNotFound } from '../errors/address-not-found.error';
import { AddressModel } from '../models/address.model';
import { toAddressModel } from '../models/to-address-model.util';
import { UpdateAddressInput } from '../models/update-address-input.model';
import { resolveCallerOwnedProfileIds } from './resolve-address-owner-profile.util';

/**
 * Orchestrates `Mutation.updateAddress` — a partial update of the
 * location/label fields ONLY, never `isDefault` (see `UpdateAddressInput`'s
 * own header comment: `setDefaultAddress` is the only path that ever
 * changes it) and never the owner. Takes no `ownerRole` argument: ownership
 * is resolved server-side by checking `id` against WHICHEVER of the
 * caller's own profiles actually owns it
 * (`AddressesRepository.findOneOwnedByEitherProfile`) — same
 * anti-enumeration idiom as `DeleteSavedCardService`.
 */
@Injectable()
export class UpdateAddressService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly addressesRepository: AddressesRepository,
  ) {}

  async updateAddress(
    userId: string,
    addressId: string,
    input: UpdateAddressInput,
  ): Promise<AddressModel> {
    const { customerProfileId, professionalProfileId } =
      await resolveCallerOwnedProfileIds(this.profilesRepository, userId);

    const existing = await this.addressesRepository.findOneOwnedByEitherProfile(
      addressId,
      customerProfileId,
      professionalProfileId,
    );
    if (!existing) {
      throw addressNotFound();
    }

    const ownerProfileId =
      existing.customerProfileId ?? existing.professionalProfileId;
    if (!ownerProfileId) {
      // Physically unreachable — `address_owner_shape_check` guarantees
      // exactly one of the two is non-null — kept only as a type-narrowing
      // guard, not a real runtime branch.
      throw addressNotFound();
    }

    const updated = await this.addressesRepository.updateForOwner(
      existing.ownerRole,
      ownerProfileId,
      addressId,
      {
        formattedAddress: input.formattedAddress,
        placeId: input.placeId,
        latitude: input.latitude,
        longitude: input.longitude,
        label: input.label,
      },
    );
    if (!updated) {
      // A genuine concurrent delete raced this call between the lookup
      // above and this write.
      throw addressNotFound();
    }
    return toAddressModel(updated);
  }
}
