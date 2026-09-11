import { Logger } from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { CancelEngagementByCustomerService } from './cancel-engagement-by-customer.service';

describe('CancelEngagementByCustomerService', () => {
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
      status: overrides?.status ?? EngagementStatus.ACCEPTED,
      startedAt: null,
      finishedAt: null,
      cancelledAt: null,
      cancelReason: null,
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
    const cancelledEngagement = engagement
      ? {
          ...engagement,
          status: EngagementStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: 'no longer needed',
        }
      : null;
    const findById = jest
      .fn()
      .mockResolvedValueOnce(engagement)
      .mockResolvedValueOnce(cancelledEngagement);
    const cancelIfActive = jest
      .fn()
      .mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const engagementsRepository = {
      findById,
      cancelIfActive,
    } as unknown as EngagementsRepository;

    const service = new CancelEngagementByCustomerService(
      prisma,
      profilesRepository,
      engagementsRepository,
    );

    return {
      service,
      $transaction,
      findCustomerProfileByUserId,
      findById,
      cancelIfActive,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('transitions an ACCEPTED Engagement to CANCELLED and logs the event', async () => {
    const { service, cancelIfActive, findById } = makeService();

    const result = await service.cancelEngagementByCustomer(
      'user-1',
      'engagement-1',
      'no longer needed',
    );

    expect(cancelIfActive).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
      'no longer needed',
    );
    expect(findById).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(EngagementStatus.CANCELLED);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'engagement_cancelled_by_customer' }),
    );
  });

  it('transitions an IN_PROGRESS Engagement to CANCELLED', async () => {
    const { service } = makeService({
      engagement: makeEngagement({ status: EngagementStatus.IN_PROGRESS }),
    });

    const result = await service.cancelEngagementByCustomer(
      'user-1',
      'engagement-1',
      'reason',
    );

    expect(result.status).toBe(EngagementStatus.CANCELLED);
  });

  it('throws ENGAGEMENT_NOT_FOUND when the caller has no CustomerProfile (the Professional), and never opens a transaction', async () => {
    const { service, $transaction } = makeService({
      customerProfile: null,
    });

    await expect(
      service.cancelEngagementByCustomer('user-1', 'engagement-1', 'reason'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_NOT_FOUND for a nonexistent Engagement', async () => {
    const { service } = makeService({ engagement: null });

    await expect(
      service.cancelEngagementByCustomer('user-1', 'nope', 'reason'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('throws ENGAGEMENT_NOT_FOUND (same code) when the Engagement belongs to another Customer', async () => {
    const { service } = makeService({
      engagement: makeEngagement({
        customerProfileId: 'someone-elses-profile',
      }),
    });

    await expect(
      service.cancelEngagementByCustomer('user-1', 'engagement-1', 'reason'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it.each([
    EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
    EngagementStatus.COMPLETED,
    EngagementStatus.CANCELLED,
  ])(
    'throws ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER when the Engagement is %s, and never opens a transaction',
    async (status) => {
      const { service, $transaction } = makeService({
        engagement: makeEngagement({ status }),
      });

      await expect(
        service.cancelEngagementByCustomer('user-1', 'engagement-1', 'reason'),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER',
      });
      expect($transaction).not.toHaveBeenCalled();
    },
  );

  it('throws ENGAGEMENT_CANCEL_CONFLICT when the guarded CAS loses the race (count 0)', async () => {
    const { service, cancelIfActive } = makeService({ casCount: 0 });

    await expect(
      service.cancelEngagementByCustomer('user-1', 'engagement-1', 'reason'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_CANCEL_CONFLICT' });
    expect(cancelIfActive).toHaveBeenCalledTimes(1);
  });
});
