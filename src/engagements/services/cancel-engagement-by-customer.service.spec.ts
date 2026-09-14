import { Logger } from '@nestjs/common';
import { CountryCode, EngagementStatus } from '@prisma/client';
import { ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES } from '../../engagement-chat/constants/engagement-lifecycle-system-messages.constants';
import { EmitEngagementLifecycleSystemMessageService } from '../../engagement-chat/services/emit-engagement-lifecycle-system-message.service';
import { RecordCustomerCancellationChargeService } from '../../ledger/services/record-customer-cancellation-charge.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { CancelEngagementByCustomerService } from './cancel-engagement-by-customer.service';

describe('CancelEngagementByCustomerService', () => {
  const customerProfile = {
    id: 'customer-profile-1',
    userId: 'user-1',
  };

  function makeBillingContextEngagement(
    overrides?: Partial<{
      customerProfileId: string;
      status: EngagementStatus;
      price: number;
      negotiatedPrice: number | null;
      country: CountryCode;
    }>,
  ) {
    return {
      customerProfileId: overrides?.customerProfileId ?? customerProfile.id,
      professionalProfileId: 'professional-profile-1',
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
      customerProfileId: customerProfile.id,
      professionalProfileId: 'professional-profile-1',
      status: EngagementStatus.CANCELLED,
      startedAt: null,
      finishedAt: null,
      cancelledAt: new Date(),
      cancelReason: 'no longer needed',
    };
  }

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
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

    const recordIfApplicable = jest.fn().mockResolvedValue(undefined);
    const recordCustomerCancellationChargeService = {
      recordIfApplicable,
    } as unknown as RecordCustomerCancellationChargeService;

    const service = new CancelEngagementByCustomerService(
      prisma,
      profilesRepository,
      engagementsRepository,
      emitEngagementLifecycleSystemMessageService,
      recordCustomerCancellationChargeService,
    );

    return {
      service,
      $transaction,
      findCustomerProfileByUserId,
      findByIdWithBillingContext,
      findById,
      cancelIfActive,
      emit,
      recordIfApplicable,
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
    expect(findById).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(EngagementStatus.CANCELLED);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'engagement_cancelled_by_customer' }),
    );
    // GOS-125
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
      ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES.CANCELLED_BY_CUSTOMER,
    );
  });

  it('calls RecordCustomerCancellationChargeService.recordIfApplicable inside the SAME transaction, with the pre-cancel billing context', async () => {
    const { service, recordIfApplicable } = makeService({
      billingContextEngagement: makeBillingContextEngagement({
        status: EngagementStatus.IN_PROGRESS,
        price: 5000,
        negotiatedPrice: 4500,
        country: CountryCode.CO,
      }),
    });

    await service.cancelEngagementByCustomer(
      'user-1',
      'engagement-1',
      'reason',
    );

    expect(recordIfApplicable).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      {
        engagementId: 'engagement-1',
        preCancelStatus: EngagementStatus.IN_PROGRESS,
        quotedPrice: 4500,
        currency: 'COP',
        customerProfileId: customerProfile.id,
        professionalProfileId: 'professional-profile-1',
      },
    );
  });

  it('falls back to the original quote price when no negotiatedPrice exists', async () => {
    const { service, recordIfApplicable } = makeService({
      billingContextEngagement: makeBillingContextEngagement({
        price: 5000,
        negotiatedPrice: null,
      }),
    });

    await service.cancelEngagementByCustomer(
      'user-1',
      'engagement-1',
      'reason',
    );

    expect(recordIfApplicable).toHaveBeenCalledWith(
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
    const { service } = makeService({ billingContextEngagement: null });

    await expect(
      service.cancelEngagementByCustomer('user-1', 'nope', 'reason'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('throws ENGAGEMENT_NOT_FOUND (same code) when the Engagement belongs to another Customer', async () => {
    const { service } = makeService({
      billingContextEngagement: makeBillingContextEngagement({
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
        billingContextEngagement: makeBillingContextEngagement({ status }),
      });

      await expect(
        service.cancelEngagementByCustomer('user-1', 'engagement-1', 'reason'),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER',
      });
      expect($transaction).not.toHaveBeenCalled();
    },
  );

  it('throws ENGAGEMENT_CANCEL_CONFLICT when the guarded CAS loses the race (count 0), and never emits the system message or records a ledger event', async () => {
    const { service, cancelIfActive, emit, recordIfApplicable } = makeService({
      casCount: 0,
    });

    await expect(
      service.cancelEngagementByCustomer('user-1', 'engagement-1', 'reason'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_CANCEL_CONFLICT' });
    expect(cancelIfActive).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
    expect(recordIfApplicable).not.toHaveBeenCalled();
  });
});
