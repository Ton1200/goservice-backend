import { Logger } from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { MarkEngagementWorkFinishedService } from './mark-engagement-work-finished.service';

describe('MarkEngagementWorkFinishedService', () => {
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
      status: overrides?.status ?? EngagementStatus.IN_PROGRESS,
      startedAt: new Date(),
      finishedAt: null,
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
    const finishedEngagement = engagement
      ? {
          ...engagement,
          status: EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
          finishedAt: new Date(),
        }
      : null;
    const findById = jest
      .fn()
      .mockResolvedValueOnce(engagement)
      .mockResolvedValueOnce(finishedEngagement);
    const finishWorkIfInProgress = jest
      .fn()
      .mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const engagementsRepository = {
      findById,
      finishWorkIfInProgress,
    } as unknown as EngagementsRepository;

    const service = new MarkEngagementWorkFinishedService(
      prisma,
      profilesRepository,
      engagementsRepository,
    );

    return {
      service,
      $transaction,
      findById,
      finishWorkIfInProgress,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('transitions an IN_PROGRESS Engagement to PENDING_CUSTOMER_CONFIRMATION and logs the event', async () => {
    const { service, finishWorkIfInProgress, findById } = makeService();

    const result = await service.markEngagementWorkFinished(
      'user-1',
      'engagement-1',
    );

    expect(finishWorkIfInProgress).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
    );
    expect(findById).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(EngagementStatus.PENDING_CUSTOMER_CONFIRMATION);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'engagement_work_finished' }),
    );
  });

  it('throws ENGAGEMENT_NOT_FOUND when the caller has no ProfessionalProfile (the Customer)', async () => {
    const { service, $transaction } = makeService({
      professionalProfile: null,
    });

    await expect(
      service.markEngagementWorkFinished('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_NOT_FOUND for a nonexistent Engagement or one owned by another Professional', async () => {
    const missing = makeService({ engagement: null });
    await expect(
      missing.service.markEngagementWorkFinished('user-1', 'nope'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });

    const foreign = makeService({
      engagement: makeEngagement({
        professionalProfileId: 'someone-elses-profile',
      }),
    });
    await expect(
      foreign.service.markEngagementWorkFinished('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('throws ENGAGEMENT_NOT_IN_PROGRESS when the Engagement has not been started, and never opens a transaction', async () => {
    const { service, $transaction } = makeService({
      engagement: makeEngagement({ status: EngagementStatus.ACCEPTED }),
    });

    await expect(
      service.markEngagementWorkFinished('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_IN_PROGRESS' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_WORK_FINISH_CONFLICT when the guarded CAS loses the race (count 0)', async () => {
    const { service, finishWorkIfInProgress } = makeService({ casCount: 0 });

    await expect(
      service.markEngagementWorkFinished('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_WORK_FINISH_CONFLICT' });
    expect(finishWorkIfInProgress).toHaveBeenCalledTimes(1);
  });
});
