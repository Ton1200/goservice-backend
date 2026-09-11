import { Logger } from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { CancelEngagementByProfessionalService } from './cancel-engagement-by-professional.service';

describe('CancelEngagementByProfessionalService', () => {
  const professionalProfile = {
    id: 'professional-profile-1',
    userId: 'user-1',
  };

  function makeEngagement(
    overrides?: Partial<{
      professionalProfileId: string;
      status: EngagementStatus;
    }>,
  ) {
    return {
      id: 'engagement-1',
      serviceRequestId: 'service-request-1',
      quoteId: 'quote-1',
      customerProfileId: 'customer-profile-1',
      professionalProfileId:
        overrides?.professionalProfileId ?? professionalProfile.id,
      status: overrides?.status ?? EngagementStatus.ACCEPTED,
      startedAt: null,
      finishedAt: null,
      cancelledAt: null,
      cancelReason: null,
    };
  }

  function makeService(overrides?: {
    professionalProfile?: typeof professionalProfile | null;
    engagement?: ReturnType<typeof makeEngagement> | null;
    casCount?: number;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

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

    const engagement =
      overrides?.engagement === undefined
        ? makeEngagement()
        : overrides.engagement;
    const cancelledEngagement = engagement
      ? {
          ...engagement,
          status: EngagementStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: 'client cancelled the job',
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

    const service = new CancelEngagementByProfessionalService(
      prisma,
      profilesRepository,
      engagementsRepository,
    );

    return {
      service,
      $transaction,
      findProfessionalProfileByUserId,
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

    const result = await service.cancelEngagementByProfessional(
      'user-1',
      'engagement-1',
      'client cancelled the job',
    );

    expect(cancelIfActive).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
      'client cancelled the job',
    );
    expect(findById).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(EngagementStatus.CANCELLED);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'engagement_cancelled_by_professional',
      }),
    );
  });

  it('transitions an IN_PROGRESS Engagement to CANCELLED', async () => {
    const { service } = makeService({
      engagement: makeEngagement({ status: EngagementStatus.IN_PROGRESS }),
    });

    const result = await service.cancelEngagementByProfessional(
      'user-1',
      'engagement-1',
      'reason',
    );

    expect(result.status).toBe(EngagementStatus.CANCELLED);
  });

  it('throws ENGAGEMENT_NOT_FOUND when the caller has no ProfessionalProfile (the Customer), and never opens a transaction', async () => {
    const { service, $transaction } = makeService({
      professionalProfile: null,
    });

    await expect(
      service.cancelEngagementByProfessional(
        'user-1',
        'engagement-1',
        'reason',
      ),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_NOT_FOUND for a nonexistent Engagement', async () => {
    const { service } = makeService({ engagement: null });

    await expect(
      service.cancelEngagementByProfessional('user-1', 'nope', 'reason'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('throws ENGAGEMENT_NOT_FOUND (same code) when the Engagement belongs to another Professional', async () => {
    const { service } = makeService({
      engagement: makeEngagement({
        professionalProfileId: 'someone-elses-profile',
      }),
    });

    await expect(
      service.cancelEngagementByProfessional(
        'user-1',
        'engagement-1',
        'reason',
      ),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it.each([
    EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
    EngagementStatus.COMPLETED,
    EngagementStatus.CANCELLED,
  ])(
    'throws ENGAGEMENT_NOT_CANCELLABLE_BY_PROFESSIONAL when the Engagement is %s, and never opens a transaction',
    async (status) => {
      const { service, $transaction } = makeService({
        engagement: makeEngagement({ status }),
      });

      await expect(
        service.cancelEngagementByProfessional(
          'user-1',
          'engagement-1',
          'reason',
        ),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_CANCELLABLE_BY_PROFESSIONAL',
      });
      expect($transaction).not.toHaveBeenCalled();
    },
  );

  it('throws ENGAGEMENT_CANCEL_CONFLICT when the guarded CAS loses the race (count 0)', async () => {
    const { service, cancelIfActive } = makeService({ casCount: 0 });

    await expect(
      service.cancelEngagementByProfessional(
        'user-1',
        'engagement-1',
        'reason',
      ),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_CANCEL_CONFLICT' });
    expect(cancelIfActive).toHaveBeenCalledTimes(1);
  });
});
