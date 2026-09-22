import { CountryCode, LedgerEntryType, PaymentMethod } from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { LedgerRepository } from '../../ledger/ledger.repository';
import {
  EngagementFinancialSummaryAccessService,
  EngagementFinancialSummaryPartyResolution,
} from '../engagement-financial-summary-access.service';
import { EngagementFinancialSummaryViewerRole } from '../models/engagement-financial-summary-viewer-role.enum';
import { EngagementPaymentEventType } from '../models/engagement-payment-event-type.enum';
import { GetEngagementFinancialSummaryService } from './get-engagement-financial-summary.service';

const SHARED_CREATED_AT = new Date('2026-09-16T12:00:00.000Z');

function makeParty(
  role: 'CUSTOMER' | 'PROFESSIONAL',
): EngagementFinancialSummaryPartyResolution {
  return {
    role,
    engagement: { id: 'engagement-1' } as never,
    customerProfileId: role === 'CUSTOMER' ? 'customer-profile-1' : null,
    professionalProfileId:
      role === 'PROFESSIONAL' ? 'professional-profile-1' : null,
  };
}

function makeEngagementContext(overrides?: {
  paymentMethod?: PaymentMethod | null;
  price?: number;
  negotiatedPrice?: number | null;
  country?: CountryCode;
}) {
  return {
    paymentMethod:
      overrides?.paymentMethod !== undefined ? overrides.paymentMethod : null,
    quote: {
      price: overrides?.price ?? 8000,
      negotiatedPrice: overrides?.negotiatedPrice ?? null,
    },
    customerProfile: { country: overrides?.country ?? CountryCode.AR },
  };
}

function makeRow(overrides: {
  id: string;
  type: LedgerEntryType;
  amount: number;
  currency?: string;
  createdAt?: Date;
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
    commissionPercentApplied: 10,
    createdAt: overrides.createdAt ?? SHARED_CREATED_AT,
  };
}

describe('GetEngagementFinancialSummaryService', () => {
  function makeService(overrides?: {
    party?: EngagementFinancialSummaryPartyResolution;
    resolvePartyRejects?: Error;
    engagementContext?: ReturnType<typeof makeEngagementContext>;
    rows?: ReturnType<typeof makeRow>[];
  }) {
    const resolveParty = overrides?.resolvePartyRejects
      ? jest.fn().mockRejectedValue(overrides.resolvePartyRejects)
      : jest.fn().mockResolvedValue(overrides?.party ?? makeParty('CUSTOMER'));
    const accessService = {
      resolveParty,
    } as unknown as EngagementFinancialSummaryAccessService;

    const findByIdWithFinancialSummaryContext = jest
      .fn()
      .mockResolvedValue(
        overrides?.engagementContext ?? makeEngagementContext(),
      );
    const engagementsRepository = {
      findByIdWithFinancialSummaryContext,
    } as unknown as EngagementsRepository;

    const findManyByEngagementId = jest
      .fn()
      .mockResolvedValue(overrides?.rows ?? []);
    const ledgerRepository = {
      findManyByEngagementId,
    } as unknown as LedgerRepository;

    const service = new GetEngagementFinancialSummaryService(
      accessService,
      engagementsRepository,
      ledgerRepository,
    );

    return { service, resolveParty, findManyByEngagementId };
  }

  describe('pre-event (no LedgerEntry yet)', () => {
    it('CUSTOMER caller: only customer is populated, workAmount = quotedPrice, everything else 0', async () => {
      const { service } = makeService({ party: makeParty('CUSTOMER') });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result).toMatchObject({
        engagementId: 'engagement-1',
        eventType: null,
        occurredAt: null,
        paymentMethod: null,
        currency: 'ARS',
        viewerRole: EngagementFinancialSummaryViewerRole.CUSTOMER,
        professional: null,
      });
      expect(result.customer).toMatchObject({
        workAmount: 8000,
        platformFee: 0,
        cancellationFee: 0,
        refundAmount: 0,
        totalCharged: 0,
      });
    });

    it('PROFESSIONAL caller: only professional is populated, grossAmount = quotedPrice, everything else 0', async () => {
      const { service } = makeService({ party: makeParty('PROFESSIONAL') });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.customer).toBeNull();
      expect(result.professional).toMatchObject({
        grossAmount: 8000,
        platformCommission: 0,
        netAmount: 0,
        cashCommissionDebt: 0,
        walletImpact: 0,
      });
    });

    it('uses negotiatedPrice over price when deriving quotedPrice', async () => {
      const { service } = makeService({
        party: makeParty('CUSTOMER'),
        engagementContext: makeEngagementContext({
          price: 5000,
          negotiatedPrice: 4500,
        }),
      });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.customer?.workAmount).toBe(4500);
    });

    it('derives currency from CustomerProfile.country via CURRENCY_BY_COUNTRY', async () => {
      const { service } = makeService({
        party: makeParty('CUSTOMER'),
        engagementContext: makeEngagementContext({ country: CountryCode.CO }),
      });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.currency).toBe('COP');
    });
  });

  describe('CASH_PAYMENT event', () => {
    const rows = [
      makeRow({
        id: 'entry-1',
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: 800,
      }),
    ];

    it('CUSTOMER caller: only customer populated — totalCharged = full quotedPrice, no fee/refund', async () => {
      const { service } = makeService({ party: makeParty('CUSTOMER'), rows });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.eventType).toBe(EngagementPaymentEventType.CASH_PAYMENT);
      expect(result.professional).toBeNull();
      expect(result.customer).toMatchObject({
        workAmount: 8000,
        platformFee: 0,
        cancellationFee: 0,
        refundAmount: 0,
        totalCharged: 8000,
      });
    });

    it('PROFESSIONAL caller: only professional populated — netAmount/walletImpact = quotedPrice - commission', async () => {
      const { service } = makeService({
        party: makeParty('PROFESSIONAL'),
        rows,
      });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.customer).toBeNull();
      expect(result.professional).toMatchObject({
        grossAmount: 8000,
        platformCommission: 800,
        netAmount: 7200,
        cashCommissionDebt: 800,
        walletImpact: 7200,
      });
    });
  });

  describe('CUSTOMER_CANCELLATION event', () => {
    const rows = [
      makeRow({
        id: 'entry-fee',
        type: LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
        amount: -800,
      }),
      makeRow({
        id: 'entry-commission',
        type: LedgerEntryType.PLATFORM_COMMISSION,
        amount: 80,
      }),
      makeRow({
        id: 'entry-net',
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        amount: 720,
      }),
    ];

    it('CUSTOMER caller: only customer populated — cancellationFee/platformFee/totalCharged reflect the fee', async () => {
      const { service } = makeService({ party: makeParty('CUSTOMER'), rows });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.eventType).toBe(
        EngagementPaymentEventType.CUSTOMER_CANCELLATION,
      );
      expect(result.professional).toBeNull();
      expect(result.customer).toMatchObject({
        workAmount: 8000,
        platformFee: 80,
        cancellationFee: 800,
        refundAmount: 0,
        totalCharged: 800,
      });
    });

    it('PROFESSIONAL caller: only professional populated — walletImpact = netAmount (corrected)', async () => {
      const { service } = makeService({
        party: makeParty('PROFESSIONAL'),
        rows,
      });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.customer).toBeNull();
      expect(result.professional).toMatchObject({
        grossAmount: 800,
        platformCommission: 80,
        netAmount: 720,
        cashCommissionDebt: 0,
        walletImpact: 720,
      });
    });
  });

  describe('PROFESSIONAL_CANCELLATION event (a lone REFUND row)', () => {
    const rows = [
      makeRow({
        id: 'entry-refund',
        type: LedgerEntryType.REFUND,
        amount: 4000,
      }),
    ];

    it('CUSTOMER caller: only customer populated — refundAmount reflects the real REFUND row, everything else 0', async () => {
      const { service } = makeService({ party: makeParty('CUSTOMER'), rows });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.eventType).toBe(
        EngagementPaymentEventType.PROFESSIONAL_CANCELLATION,
      );
      expect(result.professional).toBeNull();
      expect(result.customer).toMatchObject({
        workAmount: 8000,
        platformFee: 0,
        cancellationFee: 0,
        refundAmount: 4000,
        totalCharged: 0,
      });
    });

    it('PROFESSIONAL caller: only professional populated — everything 0, walletImpact 0 (never negative)', async () => {
      const { service } = makeService({
        party: makeParty('PROFESSIONAL'),
        rows,
      });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.customer).toBeNull();
      expect(result.professional).toMatchObject({
        grossAmount: 0,
        platformCommission: 0,
        netAmount: 0,
        cashCommissionDebt: 0,
        walletImpact: 0,
      });
    });
  });

  describe('DIGITAL_PAYMENT fallback (defensive, no writer yet)', () => {
    const rows = [
      makeRow({
        id: 'entry-digital',
        type: LedgerEntryType.CUSTOMER_CHARGE,
        amount: 6000,
      }),
    ];

    it('classifies as DIGITAL_PAYMENT with zero commission/net split and zero walletImpact', async () => {
      const { service } = makeService({
        party: makeParty('PROFESSIONAL'),
        rows,
      });

      const result = await service.getEngagementFinancialSummary(
        'user-1',
        'engagement-1',
      );

      expect(result.eventType).toBe(EngagementPaymentEventType.DIGITAL_PAYMENT);
      expect(result.professional).toMatchObject({
        grossAmount: 6000,
        platformCommission: 0,
        netAmount: 0,
        cashCommissionDebt: 0,
        walletImpact: 0,
      });
    });
  });

  it('most-recent-event-only: two distinct events on the same Engagement — only the LATER one is reflected', async () => {
    const rows = [
      makeRow({
        id: 'entry-refund',
        type: LedgerEntryType.REFUND,
        amount: 8000,
        createdAt: new Date('2026-09-16T10:00:00.000Z'),
      }),
      makeRow({
        id: 'entry-cash',
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: 800,
        createdAt: new Date('2026-09-10T10:00:00.000Z'),
      }),
    ];
    const { service } = makeService({ party: makeParty('CUSTOMER'), rows });

    const result = await service.getEngagementFinancialSummary(
      'user-1',
      'engagement-1',
    );

    expect(result.eventType).toBe(
      EngagementPaymentEventType.PROFESSIONAL_CANCELLATION,
    );
  });

  it('propagates ENGAGEMENT_NOT_FOUND (anti-enumeration) from the access service for a third party', async () => {
    const { service } = makeService({
      resolvePartyRejects: Object.assign(new Error('Engagement not found.'), {
        code: 'ENGAGEMENT_NOT_FOUND',
      }),
    });

    await expect(
      service.getEngagementFinancialSummary('third-party-user', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });
});
