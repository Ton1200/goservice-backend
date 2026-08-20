import { ProfilesRepository } from '../profiles/profiles.repository';
import { DiscoveryRepository } from './discovery.repository';

describe('DiscoveryRepository', () => {
  it('delegates to ProfilesRepository.findApproximateProfessionalProfilesInBoundingBox unchanged (never touches Prisma itself)', async () => {
    const expected = [{ id: 'candidate-1' }];
    const findApproximateProfessionalProfilesInBoundingBox = jest
      .fn()
      .mockResolvedValue(expected);
    const profilesRepository = {
      findApproximateProfessionalProfilesInBoundingBox,
    } as unknown as ProfilesRepository;
    const repository = new DiscoveryRepository(profilesRepository);
    const box = { minLat: -35, maxLat: -34, minLng: -59, maxLng: -58 };

    const result = await repository.findCandidateProfessionalProfiles(box, [
      'cat-1',
    ]);

    expect(result).toBe(expected);
    expect(
      findApproximateProfessionalProfilesInBoundingBox,
    ).toHaveBeenCalledWith(box, ['cat-1']);
  });

  it('passes categoryIds through as undefined when omitted', async () => {
    const findApproximateProfessionalProfilesInBoundingBox = jest
      .fn()
      .mockResolvedValue([]);
    const profilesRepository = {
      findApproximateProfessionalProfilesInBoundingBox,
    } as unknown as ProfilesRepository;
    const repository = new DiscoveryRepository(profilesRepository);
    const box = { minLat: -35, maxLat: -34, minLng: -59, maxLng: -58 };

    await repository.findCandidateProfessionalProfiles(box);

    expect(
      findApproximateProfessionalProfilesInBoundingBox,
    ).toHaveBeenCalledWith(box, undefined);
  });
});
