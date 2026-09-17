import { EngagementsRepository } from '../engagements/engagements.repository';
import { ProfilesRepository } from '../profiles/profiles.repository';
import { EngagementFinancialSummaryAccessService } from './engagement-financial-summary-access.service';

describe('EngagementFinancialSummaryAccessService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'customer-user' };
  const professionalProfile = {
    id: 'professional-profile-1',
    userId: 'professional-user',
  };
  const engagement = {
    id: 'engagement-1',
    customerProfileId: customerProfile.id,
    professionalProfileId: professionalProfile.id,
    status: 'ACCEPTED',
  };

  function makeService(overrides?: {
    engagement?: typeof engagement | null;
    customerProfile?: typeof customerProfile | null;
    professionalProfile?: typeof professionalProfile | null;
  }) {
    const findById = jest
      .fn()
      .mockResolvedValue(
        overrides?.engagement === undefined ? engagement : overrides.engagement,
      );
    const engagementsRepository = {
      findById,
    } as unknown as EngagementsRepository;

    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? null
          : overrides.customerProfile,
      );
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? null
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findCustomerProfileByUserId,
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const service = new EngagementFinancialSummaryAccessService(
      profilesRepository,
      engagementsRepository,
    );

    return { service };
  }

  it('resolves the owning Customer as CUSTOMER', async () => {
    const { service } = makeService({ customerProfile });

    const result = await service.resolveParty('customer-user', 'engagement-1');

    expect(result).toMatchObject({
      role: 'CUSTOMER',
      customerProfileId: customerProfile.id,
      professionalProfileId: null,
    });
  });

  it('resolves the owning Professional as PROFESSIONAL', async () => {
    const { service } = makeService({ professionalProfile });

    const result = await service.resolveParty(
      'professional-user',
      'engagement-1',
    );

    expect(result).toMatchObject({
      role: 'PROFESSIONAL',
      customerProfileId: null,
      professionalProfileId: professionalProfile.id,
    });
  });

  it('tryResolveParty returns null for a third party', async () => {
    const { service } = makeService();

    const result = await service.tryResolveParty(
      'third-party-user',
      'engagement-1',
    );

    expect(result).toBeNull();
  });

  it('resolveParty throws ENGAGEMENT_NOT_FOUND (anti-enumeration) for a third party', async () => {
    const { service } = makeService();

    await expect(
      service.resolveParty('third-party-user', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('resolveParty throws ENGAGEMENT_NOT_FOUND (same code) for a nonexistent Engagement', async () => {
    const { service } = makeService({ engagement: null });

    await expect(
      service.resolveParty('customer-user', 'nope'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });
});
