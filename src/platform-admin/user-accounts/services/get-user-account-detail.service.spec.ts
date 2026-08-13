import { UsersRepository } from '../../../users/users.repository';
import { GetUserAccountDetailService } from './get-user-account-detail.service';

describe('GetUserAccountDetailService', () => {
  function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phoneCountryCode: '+54',
      phoneNumber: '91122334455',
      accountStatus: 'EMAIL_VERIFIED',
      authProvider: 'PASSWORD',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      customerProfile: null,
      professionalProfile: null,
      ...overrides,
    };
  }

  function makeService(row: unknown) {
    const findByIdForAdminWithProfiles = jest.fn().mockResolvedValue(row);
    const usersRepository = {
      findByIdForAdminWithProfiles,
    } as unknown as UsersRepository;
    return {
      service: new GetUserAccountDetailService(usersRepository),
      findByIdForAdminWithProfiles,
    };
  }

  it('throws USER_ACCOUNT_NOT_FOUND when the id does not resolve to a real user', async () => {
    const { service } = makeService(null);

    await expect(service.getUserAccountDetail('missing')).rejects.toMatchObject(
      { code: 'USER_ACCOUNT_NOT_FOUND' },
    );
  });

  it('derives hasCustomerProfile/hasProfessionalProfile from presence and passes the full profile objects through when both exist', async () => {
    const customerProfile = {
      id: 'cp1',
      userId: 'u1',
      displayName: 'Jane D.',
      addressLine: 'Av. Siempre Viva 742',
      city: 'Buenos Aires',
      province: 'CABA',
      country: 'AR',
      photoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const professionalProfile = {
      id: 'pp1',
      userId: 'u1',
      displayName: 'Jane the Plumber',
      city: 'Buenos Aires',
      country: 'AR',
      serviceAreaDescription: 'CABA',
      bio: 'Experienced plumber.',
      photoUrl: null,
      languages: ['es'],
      verificationStatus: 'UNVERIFIED',
      createdAt: new Date(),
      updatedAt: new Date(),
      specializations: [
        {
          category: {
            id: 'cat1',
            name: 'Plumbing',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          role: 'PRIMARY',
          description: 'General plumbing',
          yearsOfExperience: 5,
          order: 0,
        },
      ],
    };
    const { service, findByIdForAdminWithProfiles } = makeService(
      makeRow({ customerProfile, professionalProfile }),
    );

    const result = await service.getUserAccountDetail('u1');

    expect(findByIdForAdminWithProfiles).toHaveBeenCalledWith('u1');
    expect(result.hasCustomerProfile).toBe(true);
    expect(result.hasProfessionalProfile).toBe(true);
    expect(result.customerProfile).toBe(customerProfile);
    expect(result.professionalProfile).toBe(professionalProfile);
  });

  it('returns null customerProfile/professionalProfile when the user never created either', async () => {
    const { service } = makeService(makeRow());

    const result = await service.getUserAccountDetail('u1');

    expect(result.hasCustomerProfile).toBe(false);
    expect(result.hasProfessionalProfile).toBe(false);
    expect(result.customerProfile).toBeNull();
    expect(result.professionalProfile).toBeNull();
  });
});
