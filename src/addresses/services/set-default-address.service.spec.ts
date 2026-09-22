import { Address, AddressOwnerRole, Prisma } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { SetDefaultAddressService } from './set-default-address.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function buildAddressRow(overrides?: Partial<Address>): Address {
  return {
    id: 'address-2',
    ownerRole: AddressOwnerRole.CUSTOMER,
    customerProfileId: 'customer-profile-1',
    professionalProfileId: null,
    formattedAddress: 'Otra dirección 100',
    placeId: 'place-456',
    latitude: -34.6,
    longitude: -58.4,
    label: 'Trabajo',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(overrides?: {
  existing?: Address | null;
  setDefaultResult?: Address | null;
  setDefaultError?: unknown;
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
  const setDefaultForOwner = overrides?.setDefaultError
    ? jest.fn().mockRejectedValue(overrides.setDefaultError)
    : jest
        .fn()
        .mockResolvedValue(
          overrides && 'setDefaultResult' in overrides
            ? overrides.setDefaultResult
            : buildAddressRow({ isDefault: true }),
        );
  const addressesRepository = {
    findOneOwnedByEitherProfile,
    setDefaultForOwner,
  } as unknown as AddressesRepository;

  const service = new SetDefaultAddressService(
    profilesRepository,
    addressesRepository,
  );

  return { service, findOneOwnedByEitherProfile, setDefaultForOwner };
}

describe('SetDefaultAddressService', () => {
  it("marks one of the caller's own addresses as default, unmarking the previous one (happy path)", async () => {
    const { service, setDefaultForOwner } = buildService();

    const result = await service.setDefaultAddress('user-1', 'address-2');

    // The unset-previous/set-new write is the atomic transaction owned by
    // AddressesRepository.setDefaultForOwner (see that method's own
    // comment) — this asserts the service hands it the correct scoping.
    expect(setDefaultForOwner).toHaveBeenCalledWith(
      AddressOwnerRole.CUSTOMER,
      'customer-profile-1',
      'address-2',
    );
    expect(result.isDefault).toBe(true);
  });

  it("throws ADDRESS_NOT_FOUND when the address does not belong to any of the caller's own profiles", async () => {
    const { service } = buildService({ existing: null });

    await expect(
      service.setDefaultAddress('user-1', 'address-2'),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });

  it('throws ADDRESS_NOT_FOUND when a concurrent delete races the write', async () => {
    const { service } = buildService({ setDefaultResult: null });

    await expect(
      service.setDefaultAddress('user-1', 'address-2'),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
  });

  it('translates a P2002 race against a concurrent sibling call into ADDRESS_DEFAULT_CONFLICT', async () => {
    const { service } = buildService({ setDefaultError: p2002() });

    await expect(
      service.setDefaultAddress('user-1', 'address-2'),
    ).rejects.toMatchObject({ code: 'ADDRESS_DEFAULT_CONFLICT' });
  });
});
