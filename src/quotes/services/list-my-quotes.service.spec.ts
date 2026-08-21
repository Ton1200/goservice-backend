import { ProfilesRepository } from '../../profiles/profiles.repository';
import { QuotesRepository } from '../quotes.repository';
import { ListMyQuotesService } from './list-my-quotes.service';

describe('ListMyQuotesService', () => {
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
      .mockResolvedValue([{ id: 'quote-1' }]);
    const quotesRepository = {
      findManyByProfessionalProfileId,
    } as unknown as QuotesRepository;

    const service = new ListMyQuotesService(
      profilesRepository,
      quotesRepository,
    );

    return { service, findManyByProfessionalProfileId };
  }

  it("returns the caller's own Quotes", async () => {
    const { service, findManyByProfessionalProfileId } = makeService();

    const result = await service.listMyQuotes('user-1');

    expect(findManyByProfessionalProfileId).toHaveBeenCalledWith(
      professionalProfile.id,
    );
    expect(result).toHaveLength(1);
  });

  it('throws PROFESSIONAL_PROFILE_REQUIRED when the caller has no ProfessionalProfile', async () => {
    const { service } = makeService({ professionalProfile: null });

    await expect(service.listMyQuotes('user-1')).rejects.toMatchObject({
      code: 'PROFESSIONAL_PROFILE_REQUIRED',
    });
  });
});
