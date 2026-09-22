import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { addressNotFound } from '../errors/address-not-found.error';
import { defaultAddressDeleteBlocked } from '../errors/default-address-delete-blocked.error';
import { resolveCallerOwnedProfileIds } from './resolve-address-owner-profile.util';

/**
 * Orchestrates `Mutation.deleteAddress`. Same server-side ownership
 * resolution as `UpdateAddressService` (no `ownerRole` argument — see that
 * service's own comment).
 *
 * Business rule (this story's own instructions): deleting the owning
 * profile's current DEFAULT is blocked while at least one OTHER Address
 * still exists for that profile (`defaultAddressDeleteBlocked()` — the
 * caller must `setDefaultAddress` on a different one first). Deleting the
 * profile's ONLY Address (default or not) is always allowed, leaving it
 * with zero Addresses.
 */
@Injectable()
export class DeleteAddressService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly addressesRepository: AddressesRepository,
  ) {}

  async deleteAddress(userId: string, addressId: string): Promise<boolean> {
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
      throw addressNotFound();
    }

    if (existing.isDefault) {
      const totalCount = await this.addressesRepository.countForOwner(
        existing.ownerRole,
        ownerProfileId,
      );
      if (totalCount > 1) {
        throw defaultAddressDeleteBlocked();
      }
    }

    const deleted = await this.addressesRepository.deleteForOwner(
      existing.ownerRole,
      ownerProfileId,
      addressId,
    );
    if (!deleted) {
      // A genuine concurrent delete already raced this call.
      throw addressNotFound();
    }
    return true;
  }
}
