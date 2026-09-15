import { Logger } from '@nestjs/common';
import { CountryCode, EngagementStatus } from '@prisma/client';
import { RecordCashCommissionDebtService } from '../../ledger/services/record-cash-commission-debt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CashPaymentAccessService } from '../cash-payment-access.service';
import { CashPaymentRepository } from '../cash-payment.repository';
import { ConfirmCashPaymentService } from './confirm-cash-payment.service';

describe('ConfirmCashPaymentService', () => {
  const engagement = {
    id: 'engagement-1',
    customerProfileId: 'customer-profile-1',
    professionalProfileId: 'professional-profile-1',
    status: EngagementStatus.IN_PROGRESS,
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
    confirmationRow?: {
      id: string;
      engagementId: string;
      customerConfirmedAt: Date | null;
      professionalConfirmedAt: Date | null;
      commissionDebtRecorded: boolean;
      createdAt: Date;
    };
    setPaymentMethodCount?: number;
    markCommissionDebtRecordedCount?: number;
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
    const setPaymentMethodIfUnset = jest
      .fn()
      .mockResolvedValue({ count: overrides?.setPaymentMethodCount ?? 1 });
    const engagementsRepository = {
      findByIdWithBillingContext,
      setPaymentMethodIfUnset,
    } as unknown as EngagementsRepository;

    const defaultRow = {
      id: 'confirmation-1',
      engagementId: engagement.id,
      customerConfirmedAt: null,
      professionalConfirmedAt: null,
      commissionDebtRecorded: false,
      createdAt: new Date(),
    };
    const upsertConfirmation = jest
      .fn()
      .mockResolvedValue(overrides?.confirmationRow ?? defaultRow);
    const markCommissionDebtRecordedIfUnset = jest.fn().mockResolvedValue({
      count: overrides?.markCommissionDebtRecordedCount ?? 1,
    });
    const cashPaymentRepository = {
      upsertConfirmation,
      markCommissionDebtRecordedIfUnset,
    } as unknown as CashPaymentRepository;

    const recordCommissionDebt = jest.fn().mockResolvedValue(undefined);
    const recordCashCommissionDebtService = {
      recordCommissionDebt,
    } as unknown as RecordCashCommissionDebtService;

    const service = new ConfirmCashPaymentService(
      prisma,
      cashPaymentAccessService,
      engagementsRepository,
      cashPaymentRepository,
      recordCashCommissionDebtService,
    );

    return {
      service,
      $transaction,
      resolveParty,
      findByIdWithBillingContext,
      setPaymentMethodIfUnset,
      upsertConfirmation,
      markCommissionDebtRecordedIfUnset,
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
        confirmationRow: {
          id: 'confirmation-1',
          engagementId: engagement.id,
          customerConfirmedAt: new Date(),
          professionalConfirmedAt: null,
          commissionDebtRecorded: false,
          createdAt: new Date(),
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
      confirmationRow: {
        id: 'confirmation-1',
        engagementId: engagement.id,
        customerConfirmedAt: null,
        professionalConfirmedAt: new Date(),
        commissionDebtRecorded: false,
        createdAt: new Date(),
      },
    });

    await service.confirmCashPayment('user-2', 'engagement-1');

    expect(recordCommissionDebt).not.toHaveBeenCalled();
  });

  it('both confirmed and the CAS wins: records exactly ONE CASH_COMMISSION_DEBT via RecordCashCommissionDebtService, inside the same transaction', async () => {
    const { service, recordCommissionDebt } = makeService({
      confirmationRow: {
        id: 'confirmation-1',
        engagementId: engagement.id,
        customerConfirmedAt: new Date(),
        professionalConfirmedAt: new Date(),
        commissionDebtRecorded: false,
        createdAt: new Date(),
      },
      markCommissionDebtRecordedCount: 1,
    });

    await service.confirmCashPayment('user-1', 'engagement-1');

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
      confirmationRow: {
        id: 'confirmation-1',
        engagementId: engagement.id,
        customerConfirmedAt: new Date(),
        professionalConfirmedAt: new Date(),
        commissionDebtRecorded: false,
        createdAt: new Date(),
      },
    });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect(recordCommissionDebt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quotedPrice: 4500 }),
    );
  });

  it('both confirmed but the CAS is LOST (a concurrent call already recorded the debt): does not record a second LedgerEntry', async () => {
    const { service, recordCommissionDebt } = makeService({
      confirmationRow: {
        id: 'confirmation-1',
        engagementId: engagement.id,
        customerConfirmedAt: new Date(),
        professionalConfirmedAt: new Date(),
        commissionDebtRecorded: false,
        createdAt: new Date(),
      },
      markCommissionDebtRecordedCount: 0,
    });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect(recordCommissionDebt).not.toHaveBeenCalled();
  });

  it('already commissionDebtRecorded (a repeat confirm after both already confirmed): does not re-run the CAS or write a second entry', async () => {
    const { service, markCommissionDebtRecordedIfUnset, recordCommissionDebt } =
      makeService({
        confirmationRow: {
          id: 'confirmation-1',
          engagementId: engagement.id,
          customerConfirmedAt: new Date(),
          professionalConfirmedAt: new Date(),
          commissionDebtRecorded: true,
          createdAt: new Date(),
        },
      });

    await service.confirmCashPayment('user-1', 'engagement-1');

    expect(markCommissionDebtRecordedIfUnset).not.toHaveBeenCalled();
    expect(recordCommissionDebt).not.toHaveBeenCalled();
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
