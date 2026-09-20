import { LedgerEntryType, PaymentMethod } from '@prisma/client';
import { LedgerRepository } from '../../../ledger/ledger.repository';
import { PaymentAttemptRepository } from '../../../payments/payment-attempt.repository';
import { AdminEngagementPaymentEventType } from '../models/admin-engagement-payment-event-type.enum';
import { ListAdminEngagementPaymentSummariesService } from './list-admin-engagement-payment-summaries.service';

const SHARED_CREATED_AT = new Date('2026-09-14T12:00:00.000Z');

function makeEngagement(overrides?: {
  paymentMethod?: PaymentMethod | null;
  price?: number;
  negotiatedPrice?: number | null;
}) {
  return {
    id: 'engagement-1',
    paymentMethod:
      overrides?.paymentMethod !== undefined
        ? overrides.paymentMethod
        : PaymentMethod.CASH,
    quote: {
      price: overrides?.price ?? 8000,
      negotiatedPrice: overrides?.negotiatedPrice ?? null,
    },
    customerProfile: {
      id: 'customer-profile-1',
      firstName: 'María',
      lastName: 'Gómez',
      user: { id: 'customer-user-1', email: 'maria@example.com' },
    },
    professionalProfile: {
      id: 'professional-profile-1',
      firstName: 'Pedro',
      lastName: 'Ruiz',
      displayName: null,
      user: { id: 'professional-user-1', email: 'pedro@example.com' },
    },
  };
}

function makeRow(overrides: {
  id: string;
  type: LedgerEntryType;
  amount: number;
  currency?: string;
  engagement?: ReturnType<typeof makeEngagement>;
  createdAt?: Date;
  commissionPercentApplied?: number | null;
}) {
  return {
    id: overrides.id,
    receiptNumber: 1,
    type: overrides.type,
    amount: overrides.amount,
    currency: overrides.currency ?? 'ARS',
    engagementId: 'engagement-1',
    customerProfileId: 'customer-profile-1',
    professionalProfileId: 'professional-profile-1',
    commissionPercentApplied: overrides.commissionPercentApplied ?? 10,
    createdAt: overrides.createdAt ?? SHARED_CREATED_AT,
    engagement: overrides.engagement ?? makeEngagement(),
  };
}

describe('ListAdminEngagementPaymentSummariesService', () => {
  function makeService(
    rows: ReturnType<typeof makeRow>[],
    pendingDebt = 0,
    balance = 0,
  ) {
    const findManyForAdminPaymentSummaries = jest.fn().mockResolvedValue(rows);
    const sumCashCommissionDebtForProfessional = jest
      .fn()
      .mockResolvedValue(pendingDebt);
    const sumProfessionalBalance = jest.fn().mockResolvedValue(balance);
    const ledgerRepository = {
      findManyForAdminPaymentSummaries,
      sumCashCommissionDebtForProfessional,
      sumProfessionalBalance,
    } as unknown as LedgerRepository;

    const findApprovedByEngagementId = jest.fn().mockResolvedValue(null);
    const paymentAttemptRepository = {
      findApprovedByEngagementId,
    } as unknown as PaymentAttemptRepository;

    const service = new ListAdminEngagementPaymentSummariesService(
      ledgerRepository,
      paymentAttemptRepository,
    );
    return {
      service,
      sumCashCommissionDebtForProfessional,
      sumProfessionalBalance,
      findApprovedByEngagementId,
    };
  }

  it('CASH_PAYMENT: derives totalPaidByCustomer from the Quote price, platformCommission from the entry, and includes professionalTotalPendingCashDebt + the professional balance', async () => {
    const {
      service,
      sumCashCommissionDebtForProfessional,
      sumProfessionalBalance,
    } = makeService(
      [
        makeRow({
          id: 'entry-1',
          type: LedgerEntryType.CASH_COMMISSION_DEBT,
          amount: 800,
        }),
      ],
      800,
      -800,
    );

    const page = await service.listEngagementPaymentSummaries();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      engagementId: 'engagement-1',
      eventType: AdminEngagementPaymentEventType.CASH_PAYMENT,
      paymentMethod: PaymentMethod.CASH,
      totalPaidByCustomer: 8000,
      platformCommission: 800,
      professionalNetAmount: 7200,
      currency: 'ARS',
      professionalTotalPendingCashDebt: 800,
    });
    expect(page.items[0].customer).toMatchObject({
      id: 'customer-profile-1',
      firstName: 'María',
      lastName: 'Gómez',
      email: 'maria@example.com',
    });
    expect(page.items[0].professional).toMatchObject({
      id: 'professional-profile-1',
      firstName: 'Pedro',
      email: 'pedro@example.com',
      balance: -800,
    });
    expect(page.items[0].entries).toHaveLength(1);
    expect(sumCashCommissionDebtForProfessional).toHaveBeenCalledWith(
      'professional-profile-1',
    );
    expect(sumProfessionalBalance).toHaveBeenCalledWith(
      'professional-profile-1',
    );
  });

  it("attaches the Engagement's ever-approved PaymentAttempt, when one exists", async () => {
    const approvedAttempt = {
      id: 'attempt-1',
      engagementId: 'engagement-1',
      method: 'CASH',
      type: 'CASH',
      status: 'APPROVED',
      amount: 8000,
      currency: 'ARS',
      installments: 1,
      rejectionReason: null,
      providerPaymentId: null,
      cardBrand: null,
      cardLastFour: null,
      providerFeeAmount: null,
      providerTaxAmount: null,
      netReceivedAmount: null,
      customerConfirmedAt: new Date(),
      professionalConfirmedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service, findApprovedByEngagementId } = makeService([
      makeRow({
        id: 'entry-1',
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: 800,
      }),
    ]);
    findApprovedByEngagementId.mockResolvedValue(approvedAttempt);

    const page = await service.listEngagementPaymentSummaries();

    expect(findApprovedByEngagementId).toHaveBeenCalledWith('engagement-1');
    expect(page.items[0].paymentAttempt).toMatchObject({
      id: 'attempt-1',
      method: 'CASH',
      type: 'CASH',
    });
  });

  it('leaves paymentAttempt null when the job was never actually paid (e.g. cancelled)', async () => {
    const { service } = makeService([
      makeRow({
        id: 'entry-1',
        type: LedgerEntryType.REFUND,
        amount: 8000,
        engagement: makeEngagement({ paymentMethod: null }),
      }),
    ]);

    const page = await service.listEngagementPaymentSummaries();

    expect(page.items[0].paymentAttempt).toBeNull();
  });

  it('uses negotiatedPrice over price when deriving a CASH_PAYMENT total', async () => {
    const { service } = makeService([
      makeRow({
        id: 'entry-1',
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: 500,
        engagement: makeEngagement({ price: 5000, negotiatedPrice: 4500 }),
      }),
    ]);

    const page = await service.listEngagementPaymentSummaries();

    expect(page.items[0].totalPaidByCustomer).toBe(4500);
  });

  it('CUSTOMER_CANCELLATION: groups the 3-row event into one summary with the fee/commission/net breakdown', async () => {
    const cancellationEngagement = makeEngagement({
      paymentMethod: null,
    });
    const { service, sumCashCommissionDebtForProfessional } = makeService([
      makeRow({
        id: 'entry-fee',
        type: LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
        amount: -500,
        currency: 'COP',
        engagement: cancellationEngagement,
      }),
      makeRow({
        id: 'entry-commission',
        type: LedgerEntryType.PLATFORM_COMMISSION,
        amount: 50,
        currency: 'COP',
        engagement: cancellationEngagement,
      }),
      makeRow({
        id: 'entry-net',
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        amount: 450,
        currency: 'COP',
        engagement: cancellationEngagement,
      }),
    ]);

    const page = await service.listEngagementPaymentSummaries();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      eventType: AdminEngagementPaymentEventType.CUSTOMER_CANCELLATION,
      paymentMethod: null,
      totalPaidByCustomer: 500,
      platformCommission: 50,
      professionalNetAmount: 450,
      currency: 'COP',
      professionalTotalPendingCashDebt: null,
    });
    expect(page.items[0].entries).toHaveLength(3);
    // Not a cash event — never queries the professional's pending debt.
    expect(sumCashCommissionDebtForProfessional).not.toHaveBeenCalled();
  });

  it('PROFESSIONAL_CANCELLATION: a lone REFUND row summarizes as zero paid/commission/net', async () => {
    const { service } = makeService([
      makeRow({
        id: 'entry-refund',
        type: LedgerEntryType.REFUND,
        amount: 4000,
      }),
    ]);

    const page = await service.listEngagementPaymentSummaries();

    expect(page.items[0]).toMatchObject({
      eventType: AdminEngagementPaymentEventType.PROFESSIONAL_CANCELLATION,
      totalPaidByCustomer: 0,
      platformCommission: 0,
      professionalNetAmount: 0,
    });
  });

  it('groups by (engagementId, createdAt) — two DIFFERENT events on the SAME Engagement stay separate rows', async () => {
    const engagement = makeEngagement();
    const { service } = makeService([
      makeRow({
        id: 'entry-cash',
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: 800,
        engagement,
        createdAt: new Date('2026-09-10T10:00:00.000Z'),
      }),
      makeRow({
        id: 'entry-refund',
        type: LedgerEntryType.REFUND,
        amount: 8000,
        engagement,
        createdAt: new Date('2026-09-11T10:00:00.000Z'),
      }),
    ]);

    const page = await service.listEngagementPaymentSummaries();

    expect(page.totalCount).toBe(2);
    expect(page.items.map((item) => item.eventType).sort()).toEqual(
      [
        AdminEngagementPaymentEventType.CASH_PAYMENT,
        AdminEngagementPaymentEventType.PROFESSIONAL_CANCELLATION,
      ].sort(),
    );
  });

  it('clamps limit to the server-enforced max and defaults offset to 0', async () => {
    const { service } = makeService([
      makeRow({ id: 'entry-1', type: LedgerEntryType.REFUND, amount: 1000 }),
    ]);

    const page = await service.listEngagementPaymentSummaries(9999, -5);

    expect(page.limit).toBe(200);
    expect(page.offset).toBe(0);
  });
});
