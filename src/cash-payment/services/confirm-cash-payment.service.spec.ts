import { Logger } from '@nestjs/common';
import { CountryCode, EngagementStatus, PaymentMethod } from '@prisma/client';
import { RecordCashCommissionDebtService } from '../../ledger/services/record-cash-commission-debt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { PaymentAttemptRepository } from '../../payments/payment-attempt.repository';
import { CashPaymentAccessService } from '../cash-payment-access.service';
import { ConfirmCashPaymentService } from './confirm-cash-payment.service';

describe('ConfirmCashPaymentService', () => {
  const engagement: {
    id: string;
    customerProfileId: string;
    professionalProfileId: string;
    status: EngagementStatus;
    paymentMethod: PaymentMethod | null;
  } = {
    id: 'engagement-1',
    customerProfileId: 'customer-profile-1',
    professionalProfileId: 'professional-profile-1',
    status: EngagementStatus.IN_PROGRESS,
    paymentMethod: null,
  };

  const billingContext = {
    status: EngagementStatus.IN_PROGRESS,
    customerProfileId: 'customer-profile-1',
    professionalProfileId: 'professional-profile-1',
    quote: { price: 5000, negotiatedPrice: null as number | null },
    customerProfile: { country: CountryCode.AR },
  };

  function makeService(overrides?: {
    role?: 'CUSTOMER' | 'PROFESSIONAL';
    resolvedEngagement?: typeof engagement;
    billingContext?: typeof billingContext | null;
    attemptRow?: {
      id: string;
      engagementId: string;
      customerConfirmedAt: Date | null;
      professionalConfirmedAt: Date | null;
      status: 'PENDING' | 'APPROVED';
    } | null;
    resolveCount?: number;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const resolveParty = jest.fn().mockResolvedValue({
      role: overrides?.role ?? 'CUSTOMER',
      engagement: overrides?.resolvedEngagement ?? engagement,
      customerProfileId:
        (overrides?.role ?? 'CUSTOMER') === 'CUSTOMER'
          ? engagement.customerProfileId
          : null,
      professionalProfileId:
        (overrides?.role ?? 'CUSTOMER') === 'PROFESSIONAL'
          ? engagement.professionalProfileId
          : null,
    });
    const cashPaymentAccessService = {
      resolveParty,
    } as unknown as CashPaymentAccessService;

    const findByIdWithBillingContext = jest
      .fn()
      .mockResolvedValue(
        overrides?.billingContext === undefined
          ? billingContext
          : overrides.billingContext,
      );
    const setPaymentMethodIfUnset = jest.fn().mockResolvedValue({ count: 1 });
    const engagementsRepository = {
      findByIdWithBillingContext,
      setPaymentMethodIfUnset,
    } as unknown as EngagementsRepository;

    const defaultRow = {
      id: 'attempt-1',
      engagementId: engagement.id,
      customerConfirmedAt: null,
      professionalConfirmedAt: null,
      status: 'PENDING' as const,
    };
    const upsertCashConfirmation = jest
      .fn()
      .mockResolvedValue(
        overrides?.attemptRow === undefined ? defaultRow : overrides.attemptRow,
      );
    const resolveIfPending = jest
      .fn()
      .mockResolvedValue({ count: overrides?.resolveCount ?? 1 });
    const paymentAttemptRepository = {
      upsertCashConfirmation,
      resolveIfPending,
    } as unknown as PaymentAttemptRepository;

    const recordCommissionDebt = jest.fn().mockResolvedValue(undefined);
    const recordCashCommissionDebtService = {
      recordCommissionDebt,
    } as unknown as RecordCashCommissionDebtService;

    const service = new ConfirmCashPaymentService(
      prisma,
      cashPaymentAccessService,
      engagementsRepository,
      paymentAttemptRepository,
      recordCashCommissionDebtService,
    );

    return {
      service,
      $transaction,
      resolveParty,
      findByIdWithBillingContext,
      setPaymentMethodIfUnset,
      upsertCashConfirmation,
      resolveIfPending,
      recordCommissionDebt,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('only the Customer confirms: no LedgerEntry yet, but Engagement.paymentMethod is set to CASH', async () => {
    const { service, setPaymentMethodIfUnset, recordCommissionDebt } =
      makeService({
        attemptRow: {
          id: 'attempt-1',
          engagementId: engagement.id,
          customerConfirmedAt: new Date(),
          professionalConfirmedAt: null,
          status: 'PENDING',
        },
      });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect(setPaymentMethodIfUnset).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
      'CASH',
    );
    expect(recordCommissionDebt).not.toHaveBeenCalled();
  });

  it('only the Professional confirms: no LedgerEntry yet', async () => {
    const { service, recordCommissionDebt } = makeService({
      role: 'PROFESSIONAL',
      attemptRow: {
        id: 'attempt-1',
        engagementId: engagement.id,
        customerConfirmedAt: null,
        professionalConfirmedAt: new Date(),
        status: 'PENDING',
      },
    });

    await service.confirmCashPayment('user-2', 'engagement-1');

    expect(recordCommissionDebt).not.toHaveBeenCalled();
  });

  it('both confirmed and the CAS wins: records exactly ONE CASH_COMMISSION_DEBT via RecordCashCommissionDebtService, inside the same transaction', async () => {
    const { service, resolveIfPending, recordCommissionDebt } = makeService({
      attemptRow: {
        id: 'attempt-1',
        engagementId: engagement.id,
        customerConfirmedAt: new Date(),
        professionalConfirmedAt: new Date(),
        status: 'PENDING',
      },
      resolveCount: 1,
    });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect(resolveIfPending).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'attempt-1',
      { status: 'APPROVED', providerPaymentId: null, rejectionReason: null },
    );
    expect(recordCommissionDebt).toHaveBeenCalledTimes(1);
    expect(recordCommissionDebt).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      {
        engagementId: 'engagement-1',
        quotedPrice: 5000,
        currency: 'ARS',
        customerProfileId: engagement.customerProfileId,
        professionalProfileId: engagement.professionalProfileId,
      },
    );
  });

  it('uses negotiatedPrice over price when present', async () => {
    const { service, recordCommissionDebt } = makeService({
      billingContext: {
        ...billingContext,
        quote: { price: 5000, negotiatedPrice: 4500 },
      },
      attemptRow: {
        id: 'attempt-1',
        engagementId: engagement.id,
        customerConfirmedAt: new Date(),
        professionalConfirmedAt: new Date(),
        status: 'PENDING',
      },
    });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect(recordCommissionDebt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quotedPrice: 4500 }),
    );
  });

  it('both confirmed but the CAS is LOST (a concurrent call already resolved it): does not record a second LedgerEntry', async () => {
    const { service, recordCommissionDebt } = makeService({
      attemptRow: {
        id: 'attempt-1',
        engagementId: engagement.id,
        customerConfirmedAt: new Date(),
        professionalConfirmedAt: new Date(),
        status: 'PENDING',
      },
      resolveCount: 0,
    });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect(recordCommissionDebt).not.toHaveBeenCalled();
  });

  it('already APPROVED (a repeat confirm after both already confirmed): does not re-run the CAS or write a second entry', async () => {
    const { service, resolveIfPending, recordCommissionDebt } = makeService({
      attemptRow: {
        id: 'attempt-1',
        engagementId: engagement.id,
        customerConfirmedAt: new Date(),
        professionalConfirmedAt: new Date(),
        status: 'APPROVED',
      },
    });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect(resolveIfPending).not.toHaveBeenCalled();
    expect(recordCommissionDebt).not.toHaveBeenCalled();
  });

  it.each([[PaymentMethod.MERCADOPAGO], [PaymentMethod.RAPYD]])(
    'rejects with PAYMENT_METHOD_CONFLICT when the Engagement already picked %s (GOS-146: any digital provider, not just Mercado Pago)',
    async (paymentMethod) => {
      const { service, $transaction } = makeService({
        resolvedEngagement: {
          ...engagement,
          paymentMethod,
        },
      });

      await expect(
        service.confirmCashPayment('user-1', 'engagement-1'),
      ).rejects.toMatchObject({ code: 'PAYMENT_METHOD_CONFLICT' });
      expect($transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects with PAYMENT_METHOD_CONFLICT when a digital attempt wins the active slot mid-race (upsertCashConfirmation returns null)', async () => {
    const { service } = makeService({ attemptRow: null });

    await expect(
      service.confirmCashPayment('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'PAYMENT_METHOD_CONFLICT' });
  });

  it.each([EngagementStatus.ACCEPTED, EngagementStatus.CANCELLED])(
    'throws ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT when the Engagement is %s, and never opens a transaction',
    async (status) => {
      const { service, $transaction } = makeService({
        resolvedEngagement: { ...engagement, status },
      });

      await expect(
        service.confirmCashPayment('user-1', 'engagement-1'),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT',
      });
      expect($transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    EngagementStatus.IN_PROGRESS,
    EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
    EngagementStatus.COMPLETED,
  ])('allows confirmation while %s', async (status) => {
    const { service, $transaction } = makeService({
      resolvedEngagement: { ...engagement, status },
    });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates ENGAGEMENT_NOT_FOUND from CashPaymentAccessService for a non-party, before any transaction', async () => {
    const { service, $transaction, resolveParty } = makeService();
    resolveParty.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'ENGAGEMENT_NOT_FOUND' }),
    );

    await expect(
      service.confirmCashPayment('third-party', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect($transaction).not.toHaveBeenCalled();
  });
});
