import { EngagementsRepository } from '../engagements/engagements.repository';
import { ProfilesRepository } from '../profiles/profiles.repository';
import { CardPaymentAccessService } from './card-payment-access.service';

describe('CardPaymentAccessService', () => {
  const engagement = {
    id: 'engagement-1',
    customerProfileId: 'customer-1',
    professionalProfileId: 'professional-1',
  };

  function makeService(options?: {
    engagement?: object | null;
    customerProfile?: { id: string } | null;
  }) {
    const findById = jest
      .fn()
      .mockResolvedValue(
        options?.engagement === undefined ? engagement : options.engagement,
      );
    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        options?.customerProfile === undefined
          ? { id: 'customer-1' }
          : options.customerProfile,
      );
    const service = new CardPaymentAccessService(
      { findCustomerProfileByUserId } as unknown as ProfilesRepository,
      { findById } as unknown as EngagementsRepository,
    );
    return { service, findCustomerProfileByUserId };
  }

  it('returns the Engagement for its owning Customer', async () => {
    const { service } = makeService();

    await expect(
      service.resolveCustomerEngagement('user-1', 'engagement-1'),
    ).resolves.toBe(engagement);
  });

  it.each([
    ['a nonexistent Engagement', { engagement: null }],
    [
      'a caller with no CustomerProfile (e.g. only a Professional)',
      { customerProfile: null },
    ],
    [
      "another Customer's Engagement",
      { customerProfile: { id: 'someone-else' } },
    ],
  ])(
    'folds %s into the SAME anti-enumeration ENGAGEMENT_NOT_FOUND',
    async (_label, options) => {
      const { service } = makeService(options);

      await expect(
        service.resolveCustomerEngagement('user-1', 'engagement-1'),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_FOUND',
      });
    },
  );

  it("does NOT let the Engagement's Professional pay (only the Customer can)", async () => {
    // The Professional's user has no CustomerProfile matching the Engagement.
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.resolveCustomerEngagement('professional-user', 'engagement-1'),
    ).rejects.toMatchObject({
      code: 'ENGAGEMENT_NOT_FOUND',
    });
  });
});
