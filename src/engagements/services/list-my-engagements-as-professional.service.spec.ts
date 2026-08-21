import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { ListMyEngagementsAsProfessionalService } from './list-my-engagements-as-professional.service';

describe('ListMyEngagementsAsProfessionalService', () => {
  const professionalProfile = {
    id: 'professional-profile-1',
    userId: 'user-1',
  };

  function makeService(overrides?: {
    professionalProfile?: typeof professionalProfile | null;
  }) {
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? professionalProfile
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const findManyByProfessionalProfileId = jest
      .fn()
      .mockResolvedValue([{ id: 'engagement-1' }]);
    const engagementsRepository = {
      findManyByProfessionalProfileId,
    } as unknown as EngagementsRepository;

    const service = new ListMyEngagementsAsProfessionalService(
      profilesRepository,
      engagementsRepository,
    );

    return { service, findManyByProfessionalProfileId };
  }

  it("returns the caller's own Engagements as a Professional", async () => {
    const { service, findManyByProfessionalProfileId } = makeService();

    const result = await service.listMyEngagementsAsProfessional('user-1');

    expect(findManyByProfessionalProfileId).toHaveBeenCalledWith(
      professionalProfile.id,
    );
    expect(result).toHaveLength(1);
  });

  it('throws PROFESSIONAL_PROFILE_REQUIRED when the caller has no ProfessionalProfile', async () => {
    const { service } = makeService({ professionalProfile: null });

    await expect(
      service.listMyEngagementsAsProfessional('user-1'),
    ).rejects.toMatchObject({ code: 'PROFESSIONAL_PROFILE_REQUIRED' });
  });
});
