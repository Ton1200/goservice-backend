import { ProfilesRepository } from '../profiles.repository';
import { GetMyCustomerProfileService } from './get-my-customer-profile.service';

describe('GetMyCustomerProfileService', () => {
  function makeService(returnValue: unknown) {
    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(returnValue);
    const profilesRepository = {
      findCustomerProfileByUserId,
    } as unknown as ProfilesRepository;
    const service = new GetMyCustomerProfileService(profilesRepository);
    return { service, findCustomerProfileByUserId };
  }

  it('returns null when no CustomerProfile exists yet for the user', async () => {
    const { service } = makeService(null);

    const result = await service.getMyCustomerProfile('user-1');

    expect(result).toBeNull();
  });

  it('returns the repository value unchanged when a profile exists', async () => {
    const profile = { id: 'profile-1', firstName: 'Jane', lastName: 'Doe' };
    const { service, findCustomerProfileByUserId } = makeService(profile);

    const result = await service.getMyCustomerProfile('user-1');

    expect(result).toBe(profile);
    expect(findCustomerProfileByUserId).toHaveBeenCalledWith('user-1');
  });
});
