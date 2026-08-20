import { ProfilesRepository } from '../profiles.repository';
import { GetMyServiceAreaService } from './get-my-service-area.service';

describe('GetMyServiceAreaService', () => {
  it('returns the repository result unchanged when a Service Area exists', async () => {
    const serviceArea = {
      latitude: -34.6037,
      longitude: -58.3816,
      radiusKm: 15,
    };
    const findServiceAreaByUserId = jest.fn().mockResolvedValue(serviceArea);
    const profilesRepository = {
      findServiceAreaByUserId,
    } as unknown as ProfilesRepository;
    const service = new GetMyServiceAreaService(profilesRepository);

    const result = await service.getMyServiceArea('user-1');

    expect(result).toBe(serviceArea);
    expect(findServiceAreaByUserId).toHaveBeenCalledWith('user-1');
  });

  it('returns null when no Service Area has ever been set (not an error)', async () => {
    const findServiceAreaByUserId = jest.fn().mockResolvedValue(null);
    const profilesRepository = {
      findServiceAreaByUserId,
    } as unknown as ProfilesRepository;
    const service = new GetMyServiceAreaService(profilesRepository);

    const result = await service.getMyServiceArea('user-1');

    expect(result).toBeNull();
  });
});
