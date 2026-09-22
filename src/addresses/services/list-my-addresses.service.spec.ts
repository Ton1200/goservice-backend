import { Address, AddressOwnerRole } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { ListMyAddressesService } from './list-my-addresses.service';

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
  customerProfile?: { id: string } | null;
  professionalProfile?: { id: string } | null;
  rows?: Address[];
}) {
  const findCustomerProfileByUserId = jest
    .fn()
    .mockResolvedValue(
      overrides && 'customerProfile' in overrides
        ? overrides.customerProfile
        : { id: 'customer-profile-1' },
    );
  const findProfessionalProfileByUserId = jest
    .fn()
    .mockResolvedValue(
      overrides && 'professionalProfile' in overrides
        ? overrides.professionalProfile
        : { id: 'professional-profile-1' },
    );
  const profilesRepository = {
    findCustomerProfileByUserId,
    findProfessionalProfileByUserId,
  } as unknown as ProfilesRepository;

  const findManyForOwner = jest
    .fn()
    .mockResolvedValue(overrides?.rows ?? [buildAddressRow()]);
  const addressesRepository = {
    findManyForOwner,
  } as unknown as AddressesRepository;

  const service = new ListMyAddressesService(
    profilesRepository,
    addressesRepository,
  );

  return { service, findManyForOwner };
}

describe('ListMyAddressesService', () => {
  it("lists the caller's own addresses for the given ownerRole (happy path)", async () => {
    const { service, findManyForOwner } = buildService();

    const result = await service.listMyAddresses(
      'user-1',
      AddressOwnerRole.CUSTOMER,
    );

    expect(findManyForOwner).toHaveBeenCalledWith(
      AddressOwnerRole.CUSTOMER,
      'customer-profile-1',
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('address-1');
  });

  it('throws ADDRESS_OWNER_PROFILE_NOT_FOUND when the caller holds no profile of the requested ownerRole', async () => {
    const { service } = buildService({ professionalProfile: null });

    await expect(
      service.listMyAddresses('user-1', AddressOwnerRole.PROFESSIONAL),
    ).rejects.toMatchObject({ code: 'ADDRESS_OWNER_PROFILE_NOT_FOUND' });
  });

  it('returns an empty list when the profile has no saved addresses', async () => {
    const { service } = buildService({ rows: [] });

    const result = await service.listMyAddresses(
      'user-1',
      AddressOwnerRole.CUSTOMER,
    );

    expect(result).toEqual([]);
  });
});
