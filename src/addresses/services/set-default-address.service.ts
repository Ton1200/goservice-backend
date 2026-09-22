import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { addressDefaultConflict } from '../errors/address-default-conflict.error';
import { addressNotFound } from '../errors/address-not-found.error';
import { AddressModel } from '../models/address.model';
import { toAddressModel } from '../models/to-address-model.util';
import { resolveCallerOwnedProfileIds } from './resolve-address-owner-profile.util';

/**
 * Orchestrates `Mutation.setDefaultAddress`. Same server-side ownership
 * resolution as `UpdateAddressService`/`DeleteAddressService`. The actual
 * unset-previous/set-new write is one atomic transaction
 * (`AddressesRepository.setDefaultForOwner`); a CONCURRENT sibling call for
 * the same owning profile is caught via the partial unique index
 * (`Prisma.PrismaClientKnownRequestError` `P2002`) and translated into
 * `addressDefaultConflict()` here, same idiom as
 * `PayEngagementWithCardService`'s own `P2002` handling.
 */
@Injectable()
export class SetDefaultAddressService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly addressesRepository: AddressesRepository,
  ) {}

  async setDefaultAddress(
    userId: string,
    addressId: string,
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
      throw addressNotFound();
    }

    try {
      const updated = await this.addressesRepository.setDefaultForOwner(
        existing.ownerRole,
        ownerProfileId,
        addressId,
      );
      if (!updated) {
        throw addressNotFound();
      }
      return toAddressModel(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw addressDefaultConflict();
      }
      throw error;
    }
  }
}
