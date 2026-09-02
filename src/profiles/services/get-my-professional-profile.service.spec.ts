import { ProfilesRepository } from '../profiles.repository';
import { GetMyProfessionalProfileService } from './get-my-professional-profile.service';

describe('GetMyProfessionalProfileService', () => {
  function makeService(returnValue: unknown) {
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(returnValue);
    const profilesRepository = {
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;
    const service = new GetMyProfessionalProfileService(profilesRepository);
    return { service, findProfessionalProfileByUserId };
  }

  it('returns null when no ProfessionalProfile exists yet for the user', async () => {
    const { service } = makeService(null);

    const result = await service.getMyProfessionalProfile('user-1');

    expect(result).toBeNull();
  });

  it('returns the repository value unchanged when a profile exists', async () => {
    const profile = {
      id: 'profile-1',
      firstName: 'Juan',
      lastName: 'Perez',
      displayName: null,
      specializations: [],
    };
    const { service, findProfessionalProfileByUserId } = makeService(profile);

    const result = await service.getMyProfessionalProfile('user-1');

    expect(result).toBe(profile);
    expect(findProfessionalProfileByUserId).toHaveBeenCalledWith('user-1');
  });
});
