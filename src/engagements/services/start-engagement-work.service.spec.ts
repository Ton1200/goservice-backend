import { Logger } from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { AppointmentsRepository } from '../../appointments/appointments.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { StartEngagementWorkService } from './start-engagement-work.service';

describe('StartEngagementWorkService', () => {
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
    };
  }

  function makeService(overrides?: {
    professionalProfile?: typeof professionalProfile | null;
    engagement?: ReturnType<typeof makeEngagement> | null;
    confirmedCount?: number;
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
    const inProgressEngagement = engagement
      ? {
          ...engagement,
          status: EngagementStatus.IN_PROGRESS,
          startedAt: new Date(),
        }
      : null;
    const findById = jest
      .fn()
      .mockResolvedValueOnce(engagement)
      .mockResolvedValueOnce(inProgressEngagement);
    const startWorkIfAccepted = jest
      .fn()
      .mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const engagementsRepository = {
      findById,
      startWorkIfAccepted,
    } as unknown as EngagementsRepository;

    const countConfirmedByEngagementId = jest
      .fn()
      .mockResolvedValue(overrides?.confirmedCount ?? 1);
    const appointmentsRepository = {
      countConfirmedByEngagementId,
    } as unknown as AppointmentsRepository;

    const service = new StartEngagementWorkService(
      prisma,
      profilesRepository,
      engagementsRepository,
      appointmentsRepository,
    );

    return {
      service,
      $transaction,
      findProfessionalProfileByUserId,
      findById,
      startWorkIfAccepted,
      countConfirmedByEngagementId,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('transitions an ACCEPTED Engagement with a CONFIRMED Appointment to IN_PROGRESS and logs the event', async () => {
    const { service, startWorkIfAccepted, findById } = makeService();

    const result = await service.startEngagementWork('user-1', 'engagement-1');

    expect(startWorkIfAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
    );
    expect(findById).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(EngagementStatus.IN_PROGRESS);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'engagement_work_started' }),
    );
  });

  it('throws ENGAGEMENT_NOT_FOUND when the caller has no ProfessionalProfile (the Customer), and never opens a transaction', async () => {
    const { service, $transaction } = makeService({
      professionalProfile: null,
    });

    await expect(
      service.startEngagementWork('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_NOT_FOUND for a nonexistent Engagement', async () => {
    const { service } = makeService({ engagement: null });

    await expect(
      service.startEngagementWork('user-1', 'nope'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('throws ENGAGEMENT_NOT_FOUND (same code) when the Engagement belongs to another Professional', async () => {
    const { service } = makeService({
      engagement: makeEngagement({
        professionalProfileId: 'someone-elses-profile',
      }),
    });

    await expect(
      service.startEngagementWork('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('throws ENGAGEMENT_NOT_ACCEPTED when the Engagement is not in ACCEPTED, and never checks appointments or opens a transaction', async () => {
    const { service, countConfirmedByEngagementId, $transaction } = makeService(
      {
        engagement: makeEngagement({ status: EngagementStatus.IN_PROGRESS }),
      },
    );

    await expect(
      service.startEngagementWork('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_ACCEPTED' });
    expect(countConfirmedByEngagementId).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT when there is no CONFIRMED Appointment, and never opens a transaction', async () => {
    const { service, $transaction } = makeService({ confirmedCount: 0 });

    await expect(
      service.startEngagementWork('user-1', 'engagement-1'),
    ).rejects.toMatchObject({
      code: 'ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT',
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_WORK_START_CONFLICT when the guarded CAS loses the race (count 0)', async () => {
    const { service, startWorkIfAccepted } = makeService({ casCount: 0 });

    await expect(
      service.startEngagementWork('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_WORK_START_CONFLICT' });
    expect(startWorkIfAccepted).toHaveBeenCalledTimes(1);
  });
});
