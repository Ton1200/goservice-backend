import { Logger } from '@nestjs/common';
import { CountryCode, EngagementStatus } from '@prisma/client';
import { ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES } from '../../engagement-chat/constants/engagement-lifecycle-system-messages.constants';
import { EmitEngagementLifecycleSystemMessageService } from '../../engagement-chat/services/emit-engagement-lifecycle-system-message.service';
import { RecordProfessionalCancellationRefundService } from '../../ledger/services/record-professional-cancellation-refund.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { CancelEngagementByProfessionalService } from './cancel-engagement-by-professional.service';

describe('CancelEngagementByProfessionalService', () => {
  const professionalProfile = {
    id: 'professional-profile-1',
    userId: 'user-1',
  };

  function makeBillingContextEngagement(
    overrides?: Partial<{
      professionalProfileId: string;
      status: EngagementStatus;
      price: number;
      negotiatedPrice: number | null;
      country: CountryCode;
    }>,
  ) {
    return {
      customerProfileId: 'customer-profile-1',
      professionalProfileId:
        overrides?.professionalProfileId ?? professionalProfile.id,
      status: overrides?.status ?? EngagementStatus.ACCEPTED,
      quote: {
        price: overrides?.price ?? 5000,
        negotiatedPrice: overrides?.negotiatedPrice ?? null,
      },
      customerProfile: { country: overrides?.country ?? CountryCode.AR },
    };
  }

  function makeFinalEngagement() {
    return {
      id: 'engagement-1',
      serviceRequestId: 'service-request-1',
      quoteId: 'quote-1',
      customerProfileId: 'customer-profile-1',
      professionalProfileId: professionalProfile.id,
      status: EngagementStatus.CANCELLED,
      startedAt: null,
      finishedAt: null,
      cancelledAt: new Date(),
      cancelReason: 'client cancelled the job',
    };
  }

  function makeService(overrides?: {
    professionalProfile?: typeof professionalProfile | null;
    billingContextEngagement?: ReturnType<
      typeof makeBillingContextEngagement
    > | null;
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

    const billingContextEngagement =
      overrides?.billingContextEngagement === undefined
        ? makeBillingContextEngagement()
        : overrides.billingContextEngagement;
    const findByIdWithBillingContext = jest
      .fn()
      .mockResolvedValue(billingContextEngagement);
    const findById = jest.fn().mockResolvedValue(makeFinalEngagement());
    const cancelIfActive = jest
      .fn()
      .mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const engagementsRepository = {
      findByIdWithBillingContext,
      findById,
      cancelIfActive,
    } as unknown as EngagementsRepository;

    const emit = jest.fn().mockResolvedValue(undefined);
    const emitEngagementLifecycleSystemMessageService = {
      emit,
    } as unknown as EmitEngagementLifecycleSystemMessageService;

    const record = jest.fn().mockResolvedValue(undefined);
    const recordProfessionalCancellationRefundService = {
      record,
    } as unknown as RecordProfessionalCancellationRefundService;

    const service = new CancelEngagementByProfessionalService(
      prisma,
      profilesRepository,
      engagementsRepository,
      emitEngagementLifecycleSystemMessageService,
      recordProfessionalCancellationRefundService,
    );

    return {
      service,
      $transaction,
      findProfessionalProfileByUserId,
      findByIdWithBillingContext,
      findById,
      cancelIfActive,
      emit,
      record,
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
    const { service, cancelIfActive, findById, emit } = makeService();

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
    expect(findById).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(EngagementStatus.CANCELLED);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'engagement_cancelled_by_professional',
      }),
    );
    // GOS-125
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
      ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES.CANCELLED_BY_PROFESSIONAL,
    );
  });

  it('calls RecordProfessionalCancellationRefundService.record inside the SAME transaction, for the full quoted price — regardless of preCancelStatus', async () => {
    const { service, record } = makeService({
      billingContextEngagement: makeBillingContextEngagement({
        status: EngagementStatus.IN_PROGRESS,
        price: 5000,
        negotiatedPrice: 4500,
        country: CountryCode.CO,
      }),
    });

    await service.cancelEngagementByProfessional(
      'user-1',
      'engagement-1',
      'reason',
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      {
        engagementId: 'engagement-1',
        quotedPrice: 4500,
        currency: 'COP',
        customerProfileId: 'customer-profile-1',
      },
    );
  });

  it('falls back to the original quote price when no negotiatedPrice exists', async () => {
    const { service, record } = makeService({
      billingContextEngagement: makeBillingContextEngagement({
        price: 5000,
        negotiatedPrice: null,
      }),
    });

    await service.cancelEngagementByProfessional(
      'user-1',
      'engagement-1',
      'reason',
    );

    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quotedPrice: 5000, currency: 'ARS' }),
    );
  });

  it('transitions an IN_PROGRESS Engagement to CANCELLED', async () => {
    const { service } = makeService({
      billingContextEngagement: makeBillingContextEngagement({
        status: EngagementStatus.IN_PROGRESS,
      }),
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
    const { service } = makeService({ billingContextEngagement: null });

    await expect(
      service.cancelEngagementByProfessional('user-1', 'nope', 'reason'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('throws ENGAGEMENT_NOT_FOUND (same code) when the Engagement belongs to another Professional', async () => {
    const { service } = makeService({
      billingContextEngagement: makeBillingContextEngagement({
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
        billingContextEngagement: makeBillingContextEngagement({ status }),
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

  it('throws ENGAGEMENT_CANCEL_CONFLICT when the guarded CAS loses the race (count 0), and never emits the system message or records a refund', async () => {
    const { service, cancelIfActive, emit, record } = makeService({
      casCount: 0,
    });

    await expect(
      service.cancelEngagementByProfessional(
        'user-1',
        'engagement-1',
        'reason',
      ),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_CANCEL_CONFLICT' });
    expect(cancelIfActive).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
