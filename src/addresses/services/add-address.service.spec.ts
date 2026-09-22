import { Address, AddressOwnerRole, Prisma } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { AddressesRepository } from '../addresses.repository';
import { AddAddressInput } from '../models/add-address-input.model';
import { AddAddressService } from './add-address.service';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function buildInput(overrides?: Partial<AddAddressInput>): AddAddressInput {
  const input = new AddAddressInput();
  input.ownerRole = AddressOwnerRole.CUSTOMER;
  input.formattedAddress = 'Av. Siempre Viva 742, Springfield';
  input.placeId = 'place-123';
  input.latitude = -34.6;
  input.longitude = -58.4;
  input.label = 'Casa';
  return Object.assign(input, overrides);
}

function buildAddressRow(overrides?: Partial<Address>): Address {
  return {
    id: 'address-1',
    ownerRole: AddressOwnerRole.CUSTOMER,
    customerProfileId: 'customer-profile-1',
    professionalProfileId: null,
    formattedAddress: 'Av. Siempre Viva 742, Springfield',
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
  existingCount?: number;
  createError?: unknown;
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

  const countForOwner = jest
    .fn()
    .mockResolvedValue(overrides?.existingCount ?? 1);
  const create = overrides?.createError
    ? jest.fn().mockRejectedValue(overrides.createError)
    : jest
        .fn()
        .mockImplementation(
          (data: Parameters<AddressesRepository['create']>[0]) =>
            Promise.resolve(buildAddressRow(data)),
        );
  const addressesRepository = {
    countForOwner,
    create,
  } as unknown as AddressesRepository;

  const service = new AddAddressService(
    profilesRepository,
    addressesRepository,
  );

  return { service, countForOwner, create, findCustomerProfileByUserId };
}

describe('AddAddressService', () => {
  it("creates an address for the caller's matching profile (happy path)", async () => {
    const { service, create } = buildService({ existingCount: 1 });

    const result = await service.addAddress('user-1', buildInput());

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerRole: AddressOwnerRole.CUSTOMER,
        customerProfileId: 'customer-profile-1',
        professionalProfileId: null,
        isDefault: false,
      }),
    );
    expect(result.id).toBe('address-1');
    expect(result.isDefault).toBe(false);
  });

  it('forces isDefault true when it is the first address for that profile', async () => {
    const { service, create } = buildService({ existingCount: 0 });

    await service.addAddress('user-1', buildInput());

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: true }),
    );
  });

  it('throws ADDRESS_OWNER_PROFILE_NOT_FOUND when the caller holds no profile of the requested ownerRole', async () => {
    const { service } = buildService({ customerProfile: null });

    await expect(
      service.addAddress('user-1', buildInput()),
    ).rejects.toMatchObject({ code: 'ADDRESS_OWNER_PROFILE_NOT_FOUND' });
  });

  it('translates a P2002 race on the first-address insert into ADDRESS_DEFAULT_CONFLICT', async () => {
    const { service } = buildService({
      existingCount: 0,
      createError: p2002(),
    });

    await expect(
      service.addAddress('user-1', buildInput()),
    ).rejects.toMatchObject({ code: 'ADDRESS_DEFAULT_CONFLICT' });
  });
});
