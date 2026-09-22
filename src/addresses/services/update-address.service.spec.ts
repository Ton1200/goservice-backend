import { Address, AddressOwnerRole } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { UpdateAddressInput } from '../models/update-address-input.model';
import { UpdateAddressService } from './update-address.service';

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
  existing?: Address | null;
  updated?: Address | null;
}) {
  const profilesRepository = {
    findCustomerProfileByUserId: jest
      .fn()
      .mockResolvedValue(
        overrides && 'customerProfile' in overrides
          ? overrides.customerProfile
          : { id: 'customer-profile-1' },
      ),
    findProfessionalProfileByUserId: jest
      .fn()
      .mockResolvedValue(
        overrides && 'professionalProfile' in overrides
          ? overrides.professionalProfile
          : null,
      ),
  } as unknown as ProfilesRepository;

  const findOneOwnedByEitherProfile = jest
    .fn()
    .mockResolvedValue(
      overrides && 'existing' in overrides
        ? overrides.existing
        : buildAddressRow(),
    );
  const updateForOwner = jest
    .fn()
    .mockResolvedValue(
      overrides && 'updated' in overrides
        ? overrides.updated
        : buildAddressRow({ label: 'Trabajo' }),
    );
  const addressesRepository = {
    findOneOwnedByEitherProfile,
    updateForOwner,
  } as unknown as AddressesRepository;

  const service = new UpdateAddressService(
    profilesRepository,
    addressesRepository,
  );

  return { service, findOneOwnedByEitherProfile, updateForOwner };
}

function buildInput(
  overrides?: Partial<UpdateAddressInput>,
): UpdateAddressInput {
  return Object.assign(
    new UpdateAddressInput(),
    { label: 'Trabajo' },
    overrides,
  );
}

describe('UpdateAddressService', () => {
  it("updates one of the caller's own addresses (happy path)", async () => {
    const { service, updateForOwner } = buildService();

    const result = await service.updateAddress(
      'user-1',
      'address-1',
      buildInput(),
    );

    expect(updateForOwner).toHaveBeenCalledWith(
      AddressOwnerRole.CUSTOMER,
      'customer-profile-1',
      'address-1',
      expect.objectContaining({ label: 'Trabajo' }),
    );
    expect(result.label).toBe('Trabajo');
  });

  it("throws ADDRESS_NOT_FOUND when the address does not belong to any of the caller's own profiles", async () => {
    const { service } = buildService({ existing: null });

    await expect(
      service.updateAddress('user-1', 'address-1', buildInput()),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });

  it('throws ADDRESS_NOT_FOUND when a concurrent delete races the update', async () => {
    const { service } = buildService({ updated: null });

    await expect(
      service.updateAddress('user-1', 'address-1', buildInput()),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });
});
