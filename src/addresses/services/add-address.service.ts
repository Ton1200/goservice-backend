import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { addressDefaultConflict } from '../errors/address-default-conflict.error';
import { AddAddressInput } from '../models/add-address-input.model';
import { AddressOwnerRole } from '../models/address-owner-role.enum';
import { AddressModel } from '../models/address.model';
import { toAddressModel } from '../models/to-address-model.util';
import { resolveAddressOwnerProfileId } from './resolve-address-owner-profile.util';

/**
 * Orchestrates `Mutation.addAddress`. `input.ownerRole` is the one field
 * this capability trusts from the client (see `AddAddressInput`'s own
 * header comment) — this service still verifies the caller actually holds
 * a profile of that type (`addressOwnerProfileNotFound()` otherwise) before
 * writing anything.
 *
 * Business rule (this story's own instructions): a profile with zero
 * Addresses has no default; the FIRST Address ever saved for a profile is
 * ALWAYS forced default, regardless of what the caller submitted — there is
 * no `isDefault` field on `AddAddressInput` at all, so this is the only
 * path that can ever produce it.
 */
@Injectable()
export class AddAddressService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly addressesRepository: AddressesRepository,
  ) {}

  async addAddress(
    userId: string,
    input: AddAddressInput,
  ): Promise<AddressModel> {
    const ownerProfileId = await resolveAddressOwnerProfileId(
      this.profilesRepository,
      userId,
      input.ownerRole,
    );

    const existingCount = await this.addressesRepository.countForOwner(
      input.ownerRole,
      ownerProfileId,
    );
    const isDefault = existingCount === 0;

    try {
      const created = await this.addressesRepository.create({
        ownerRole: input.ownerRole,
        customerProfileId:
          input.ownerRole === AddressOwnerRole.CUSTOMER ? ownerProfileId : null,
        professionalProfileId:
          input.ownerRole === AddressOwnerRole.PROFESSIONAL
            ? ownerProfileId
            : null,
        formattedAddress: input.formattedAddress,
        placeId: input.placeId,
        latitude: input.latitude,
        longitude: input.longitude,
        label: input.label ?? null,
        isDefault,
      });
      return toAddressModel(created);
    } catch (error) {
      if (
        isDefault &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Lost a race against a CONCURRENT first-Address insert for the
        // same profile — see addressDefaultConflict()'s own comment.
        throw addressDefaultConflict();
      }
      throw error;
    }
  }
}
