import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { AddressOwnerRole } from '../models/address-owner-role.enum';
import { AddressModel } from '../models/address.model';
import { toAddressModel } from '../models/to-address-model.util';
import { resolveAddressOwnerProfileId } from './resolve-address-owner-profile.util';

/**
 * Orchestrates `Query.myAddresses`. Always scoped to the CALLER's own
 * profile for the given `ownerRole` — this query never accepts a
 * `customerProfileId`/`professionalProfileId` argument (see this story's
 * own instructions). Ordered default-first, then oldest-first (see
 * `AddressesRepository.findManyForOwner`).
 */
@Injectable()
export class ListMyAddressesService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly addressesRepository: AddressesRepository,
  ) {}

  async listMyAddresses(
    userId: string,
    ownerRole: AddressOwnerRole,
  ): Promise<AddressModel[]> {
    const ownerProfileId = await resolveAddressOwnerProfileId(
      this.profilesRepository,
      userId,
      ownerRole,
    );
    const rows = await this.addressesRepository.findManyForOwner(
      ownerRole,
      ownerProfileId,
    );
    return rows.map(toAddressModel);
  }
}
