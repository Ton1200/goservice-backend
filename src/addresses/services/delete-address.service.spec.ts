import { Address, AddressOwnerRole } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { DeleteAddressService } from './delete-address.service';

function buildAddressRow(overrides?: Partial<Address>): Address {
  return {
    id: 'address-1',
    ownerRole: AddressOwnerRole.CUSTOMER,
    customerProfileId: 'customer-profile-1',
    professionalProfileId: null,
    formattedAddress: 'Av. Siempre Viva 742',
    placeId: 'place-123',
    latitude: -34.6,
    longitude: -58.4,
    label: 'Casa',
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(overrides?: {
  existing?: Address | null;
  totalCount?: number;
  deleted?: boolean;
}) {
  const profilesRepository = {
    findCustomerProfileByUserId: jest
      .fn()
      .mockResolvedValue({ id: 'customer-profile-1' }),
    findProfessionalProfileByUserId: jest.fn().mockResolvedValue(null),
  } as unknown as ProfilesRepository;

  const findOneOwnedByEitherProfile = jest
    .fn()
    .mockResolvedValue(
      overrides && 'existing' in overrides
        ? overrides.existing
        : buildAddressRow(),
    );
  const countForOwner = jest.fn().mockResolvedValue(overrides?.totalCount ?? 1);
  const deleteForOwner = jest
    .fn()
    .mockResolvedValue(overrides?.deleted ?? true);
  const addressesRepository = {
    findOneOwnedByEitherProfile,
    countForOwner,
    deleteForOwner,
  } as unknown as AddressesRepository;

  const service = new DeleteAddressService(
    profilesRepository,
    addressesRepository,
  );

  return {
    service,
    findOneOwnedByEitherProfile,
    countForOwner,
    deleteForOwner,
  };
}

describe('DeleteAddressService', () => {
  it('deletes a non-default address (happy path)', async () => {
    const { service, deleteForOwner, countForOwner } = buildService({
      existing: buildAddressRow({ isDefault: false }),
    });

    const result = await service.deleteAddress('user-1', 'address-1');

    expect(countForOwner).not.toHaveBeenCalled();
    expect(deleteForOwner).toHaveBeenCalledWith(
      AddressOwnerRole.CUSTOMER,
      'customer-profile-1',
      'address-1',
    );
    expect(result).toBe(true);
  });

  it('throws DEFAULT_ADDRESS_DELETE_BLOCKED when deleting the default while other addresses exist', async () => {
    const { service, deleteForOwner } = buildService({
      existing: buildAddressRow({ isDefault: true }),
      totalCount: 3,
    });

    await expect(
      service.deleteAddress('user-1', 'address-1'),
    ).rejects.toMatchObject({ code: 'DEFAULT_ADDRESS_DELETE_BLOCKED' });
    expect(deleteForOwner).not.toHaveBeenCalled();
  });

  it("allows deleting the default when it is the profile's only address", async () => {
    const { service, deleteForOwner } = buildService({
      existing: buildAddressRow({ isDefault: true }),
      totalCount: 1,
    });

    const result = await service.deleteAddress('user-1', 'address-1');

    expect(deleteForOwner).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("throws ADDRESS_NOT_FOUND when the address does not belong to any of the caller's own profiles", async () => {
    const { service } = buildService({ existing: null });

    await expect(
      service.deleteAddress('user-1', 'address-1'),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });

  it('throws ADDRESS_NOT_FOUND when a concurrent delete already raced this call', async () => {
    const { service } = buildService({
      existing: buildAddressRow({ isDefault: false }),
      deleted: false,
    });

    await expect(
      service.deleteAddress('user-1', 'address-1'),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });
});
