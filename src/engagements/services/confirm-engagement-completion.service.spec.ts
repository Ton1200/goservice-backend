import { Logger } from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { ConfirmEngagementCompletionService } from './confirm-engagement-completion.service';

describe('ConfirmEngagementCompletionService', () => {
  const customerProfile = {
    id: 'customer-profile-1',
    userId: 'user-1',
  };

  function makeEngagement(
    overrides?: Partial<{
      customerProfileId: string;
      status: EngagementStatus;
    }>,
  ) {
    return {
      id: 'engagement-1',
      serviceRequestId: 'service-request-1',
      quoteId: 'quote-1',
      customerProfileId: overrides?.customerProfileId ?? customerProfile.id,
      professionalProfileId: 'professional-profile-1',
      status:
        overrides?.status ?? EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
      startedAt: new Date(),
      finishedAt: new Date(),
    };
  }

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
    engagement?: ReturnType<typeof makeEngagement> | null;
    casCount?: number;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? customerProfile
          : overrides.customerProfile,
      );
    const profilesRepository = {
      findCustomerProfileByUserId,
    } as unknown as ProfilesRepository;

    const engagement =
      overrides?.engagement === undefined
        ? makeEngagement()
        : overrides.engagement;
    const completedEngagement = engagement
      ? { ...engagement, status: EngagementStatus.COMPLETED }
      : null;
    const findById = jest
      .fn()
      .mockResolvedValueOnce(engagement)
      .mockResolvedValueOnce(completedEngagement);
    const completeIfPendingCustomerConfirmation = jest
      .fn()
      .mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const engagementsRepository = {
      findById,
      completeIfPendingCustomerConfirmation,
    } as unknown as EngagementsRepository;

    const service = new ConfirmEngagementCompletionService(
      prisma,
      profilesRepository,
      engagementsRepository,
    );

    return {
      service,
      $transaction,
      findCustomerProfileByUserId,
      findById,
      completeIfPendingCustomerConfirmation,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('transitions a PENDING_CUSTOMER_CONFIRMATION Engagement to COMPLETED and logs the event', async () => {
    const { service, completeIfPendingCustomerConfirmation, findById } =
      makeService();

    const result = await service.confirmEngagementCompletion(
      'user-1',
      'engagement-1',
    );

    expect(completeIfPendingCustomerConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
    );
    expect(findById).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(EngagementStatus.COMPLETED);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'engagement_completed' }),
    );
  });

  it('throws ENGAGEMENT_NOT_FOUND when the caller has no CustomerProfile (the Professional), and never opens a transaction', async () => {
    const { service, $transaction } = makeService({
      customerProfile: null,
    });

    await expect(
      service.confirmEngagementCompletion('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_NOT_FOUND for a nonexistent Engagement', async () => {
    const { service } = makeService({ engagement: null });

    await expect(
      service.confirmEngagementCompletion('user-1', 'nope'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('throws ENGAGEMENT_NOT_FOUND (same code) when the Engagement belongs to another Customer', async () => {
    const { service } = makeService({
      engagement: makeEngagement({
        customerProfileId: 'someone-elses-profile',
      }),
    });

    await expect(
      service.confirmEngagementCompletion('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it.each([
    EngagementStatus.ACCEPTED,
    EngagementStatus.IN_PROGRESS,
    EngagementStatus.COMPLETED,
    EngagementStatus.CANCELLED,
  ])(
    'throws ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION when the Engagement is %s, and never opens a transaction',
    async (status) => {
      const { service, $transaction } = makeService({
        engagement: makeEngagement({ status }),
      });

      await expect(
        service.confirmEngagementCompletion('user-1', 'engagement-1'),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION',
      });
      expect($transaction).not.toHaveBeenCalled();
    },
  );

  it('throws ENGAGEMENT_COMPLETION_CONFLICT when the guarded CAS loses the race (count 0)', async () => {
    const { service, completeIfPendingCustomerConfirmation } = makeService({
      casCount: 0,
    });

    await expect(
      service.confirmEngagementCompletion('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_COMPLETION_CONFLICT' });
    expect(completeIfPendingCustomerConfirmation).toHaveBeenCalledTimes(1);
  });
});
