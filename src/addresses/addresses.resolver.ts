import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { MapsModuleEnabledGuard } from './guards/maps-module-enabled.guard';
import { AddAddressInput } from './models/add-address-input.model';
import { AddressOwnerRole } from './models/address-owner-role.enum';
import { AddressModel } from './models/address.model';
import { UpdateAddressInput } from './models/update-address-input.model';
import { AddAddressService } from './services/add-address.service';
import { DeleteAddressService } from './services/delete-address.service';
import { ListMyAddressesService } from './services/list-my-addresses.service';
import { SetDefaultAddressService } from './services/set-default-address.service';
import { UpdateAddressService } from './services/update-address.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `IdentityVerificationResolver`/`SavedCardResolver`. Every operation sits
 * behind `SessionGuard` + `MapsModuleEnabledGuard` (in that order, same
 * guard-ordering convention `CardPaymentModuleEnabledGuard` establishes).
 *
 * `updateAddress`/`deleteAddress`/`setDefaultAddress` take only `id` — no
 * `ownerRole` argument — ownership is always resolved server-side (see each
 * service's own header comment). `addAddress`/`myAddresses` are the only
 * two operations that take `ownerRole` at all, since nothing else on those
 * calls could otherwise disambiguate which of a dual-role caller's profiles
 * is meant.
 */
@Resolver()
@UseGuards(SessionGuard, MapsModuleEnabledGuard)
export class AddressesResolver {
  constructor(
    private readonly addAddressService: AddAddressService,
    private readonly updateAddressService: UpdateAddressService,
    private readonly deleteAddressService: DeleteAddressService,
    private readonly setDefaultAddressService: SetDefaultAddressService,
    private readonly listMyAddressesService: ListMyAddressesService,
  ) {}

  @Query(() => [AddressModel], {
    description:
      "The caller's own saved Addresses for the given ownerRole (CUSTOMER or PROFESSIONAL) — always scoped to the caller's own matching profile, never any other user's. Default-first, then oldest-first. Rejects with ADDRESS_OWNER_PROFILE_NOT_FOUND if the caller does not hold a profile of that type.",
  })
  myAddresses(
    @CurrentUser() userId: string,
    @Args('ownerRole', { type: () => AddressOwnerRole })
    ownerRole: AddressOwnerRole,
  ): Promise<AddressModel[]> {
    return this.listMyAddressesService.listMyAddresses(userId, ownerRole);
  }

  @Mutation(() => AddressModel, {
    description:
      "Saves a new Address for the caller's own profile matching input.ownerRole. formattedAddress/placeId/latitude/longitude must already be resolved client-side (this backend never calls Google). The FIRST Address ever saved for that profile is always forced isDefault regardless of any prior state. Rejects with ADDRESS_OWNER_PROFILE_NOT_FOUND if the caller does not hold a profile of that type.",
  })
  addAddress(
    @CurrentUser() userId: string,
    @Args('input') input: AddAddressInput,
  ): Promise<AddressModel> {
    return this.addAddressService.addAddress(userId, input);
  }

  @Mutation(() => AddressModel, {
    description:
      "Partially updates one of the location/label fields of one of the caller's own saved Addresses. Never changes isDefault or the owning profile — use setDefaultAddress for that. Rejects with ADDRESS_NOT_FOUND if id does not resolve to an Address owned by the caller.",
  })
  updateAddress(
    @CurrentUser() userId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateAddressInput,
  ): Promise<AddressModel> {
    return this.updateAddressService.updateAddress(userId, id, input);
  }

  @Mutation(() => Boolean, {
    description:
      "Deletes one of the caller's own saved Addresses. Returns true. Rejects with ADDRESS_NOT_FOUND if id does not resolve to an Address owned by the caller, or DEFAULT_ADDRESS_DELETE_BLOCKED if it is the profile's current default and other Addresses still exist for it — call setDefaultAddress on a different one first.",
  })
  async deleteAddress(
    @CurrentUser() userId: string,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.deleteAddressService.deleteAddress(userId, id);
  }

  @Mutation(() => AddressModel, {
    description:
      "Marks one of the caller's own saved Addresses as the default for its owning profile, unmarking the previous default (if any) atomically. Rejects with ADDRESS_NOT_FOUND if id does not resolve to an Address owned by the caller, or ADDRESS_DEFAULT_CONFLICT on a lost race against a concurrent call for the same profile — retry.",
  })
  setDefaultAddress(
    @CurrentUser() userId: string,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<AddressModel> {
    return this.setDefaultAddressService.setDefaultAddress(userId, id);
  }
}
