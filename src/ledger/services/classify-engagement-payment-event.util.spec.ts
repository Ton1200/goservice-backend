import { LedgerEntry, LedgerEntryType } from '@prisma/client';
import {
  classifyLedgerEventRows,
  findByType,
  selectMostRecentLedgerEventRows,
} from './classify-engagement-payment-event.util';

const SHARED_CREATED_AT = new Date('2026-09-14T12:00:00.000Z');

function makeRow(overrides: {
  id: string;
  type: LedgerEntryType;
  amount: number;
  currency?: string;
  createdAt?: Date;
}): LedgerEntry {
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

describe('classifyLedgerEventRows', () => {
  it('CASH_PAYMENT: derives totalPaidByCustomer from the passed-in quotedPrice, platformCommission from the entry', () => {
    const rows = [
      makeRow({
        id: 'entry-1',
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: 800,
      }),
    ];

    const result = classifyLedgerEventRows(rows, 8000);

    expect(result).toEqual({
      eventType: 'CASH_PAYMENT',
      totalPaidByCustomer: 8000,
      platformCommission: 800,
      professionalNetAmount: 7200,
      cashCommissionDebtAmount: 800,
    });
  });

  it('CUSTOMER_CANCELLATION: groups the 3-row event into a fee/commission/net breakdown', () => {
    const rows = [
      makeRow({
        id: 'entry-fee',
        type: LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
        amount: -500,
        currency: 'COP',
      }),
      makeRow({
        id: 'entry-commission',
        type: LedgerEntryType.PLATFORM_COMMISSION,
        amount: 50,
        currency: 'COP',
      }),
      makeRow({
        id: 'entry-net',
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        amount: 450,
        currency: 'COP',
      }),
    ];

    const result = classifyLedgerEventRows(rows, 5000);

    expect(result).toEqual({
      eventType: 'CUSTOMER_CANCELLATION',
      totalPaidByCustomer: 500,
      platformCommission: 50,
      professionalNetAmount: 450,
      cashCommissionDebtAmount: 0,
    });
  });

  it('PROFESSIONAL_CANCELLATION: a lone REFUND row classifies as zero paid/commission/net', () => {
    const rows = [
      makeRow({
        id: 'entry-refund',
        type: LedgerEntryType.REFUND,
        amount: 4000,
      }),
    ];

    const result = classifyLedgerEventRows(rows, 4000);

    expect(result).toEqual({
      eventType: 'PROFESSIONAL_CANCELLATION',
      totalPaidByCustomer: 0,
      platformCommission: 0,
      professionalNetAmount: 0,
      cashCommissionDebtAmount: 0,
    });
    // The real refunded amount is still recoverable by a caller that needs
    // it, via the exported findByType helper — this classification's own
    // zeroed totalPaidByCustomer does not lose that data.
    expect(findByType(rows, LedgerEntryType.REFUND)?.amount).toBe(4000);
  });

  it('DIGITAL_PAYMENT (GOS-85): reads the real amounts from the 3-row event, abs-ing the negative CUSTOMER_CHARGE balancing leg', () => {
    // The exact shape `RecordDigitalPaymentService` writes for a 6000 job at
    // 10%: -6000 (CUSTOMER_CHARGE) + 600 (PLATFORM_COMMISSION) + 5400
    // (PROFESSIONAL_NET_CREDIT) === 0.
    const rows = [
      makeRow({
        id: 'entry-charge',
        type: LedgerEntryType.CUSTOMER_CHARGE,
        amount: -6000,
        currency: 'COP',
      }),
      makeRow({
        id: 'entry-commission',
        type: LedgerEntryType.PLATFORM_COMMISSION,
        amount: 600,
        currency: 'COP',
      }),
      makeRow({
        id: 'entry-net',
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        amount: 5400,
        currency: 'COP',
      }),
    ];

    const result = classifyLedgerEventRows(rows, 6000);

    expect(result).toEqual({
      eventType: 'DIGITAL_PAYMENT',
      totalPaidByCustomer: 6000,
      platformCommission: 600,
      professionalNetAmount: 5400,
      cashCommissionDebtAmount: 0,
    });
    // The classification reports the split as-written, so the ledger's
    // zero-sum invariant is visible through it too.
    expect(
      -result.totalPaidByCustomer +
        result.platformCommission +
        result.professionalNetAmount,
    ).toBe(0);
  });

  it('DIGITAL_PAYMENT (GOS-146): an event paid through Rapyd is the SAME branch — the ledger records the collector nowhere, so the 3-row event classifies identically to a Mercado Pago one', () => {
    // `RecordDigitalPaymentService` writes the exact same CUSTOMER_CHARGE (−) +
    // PLATFORM_COMMISSION + PROFESSIONAL_NET_CREDIT trio whichever provider
    // approved the attempt (`ApplyPaymentResultService` is provider-agnostic),
    // and `classifyLedgerEventRows` reads only the rows.
    const rows = [
      makeRow({
        id: 'entry-charge',
        type: LedgerEntryType.CUSTOMER_CHARGE,
        amount: -50000,
      }),
      makeRow({
        id: 'entry-commission',
        type: LedgerEntryType.PLATFORM_COMMISSION,
        amount: 5000,
      }),
      makeRow({
        id: 'entry-net',
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        amount: 45000,
      }),
    ];

    const result = classifyLedgerEventRows(rows, 50000);

    expect(result).toEqual({
      eventType: 'DIGITAL_PAYMENT',
      totalPaidByCustomer: 50000,
      platformCommission: 5000,
      professionalNetAmount: 45000,
      cashCommissionDebtAmount: 0,
    });
  });

  it('DIGITAL_PAYMENT (GOS-85): reports the persisted amounts, not a re-derivation from quotedPrice', () => {
    // 3333 at 10%: commission = round(333.3) = 333, net = 3000 (a remainder,
    // never independently rounded). A `quotedPrice * 0.9` re-derivation
    // would give 2999.7 — the classifier must return what was WRITTEN.
    const rows = [
      makeRow({
        id: 'c',
        type: LedgerEntryType.CUSTOMER_CHARGE,
        amount: -3333,
      }),
      makeRow({
        id: 'p',
        type: LedgerEntryType.PLATFORM_COMMISSION,
        amount: 333,
      }),
      makeRow({
        id: 'n',
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        amount: 3000,
      }),
    ];

    const result = classifyLedgerEventRows(rows, 9999);

    expect(result.totalPaidByCustomer).toBe(3333);
    expect(result.platformCommission).toBe(333);
    expect(result.professionalNetAmount).toBe(3000);
  });

  it('DIGITAL_PAYMENT: the fall-through when no more-specific type matches and no CUSTOMER_CHARGE exists reports zeros', () => {
    const result = classifyLedgerEventRows([], 6000);

    expect(result).toEqual({
      eventType: 'DIGITAL_PAYMENT',
      totalPaidByCustomer: 0,
      platformCommission: 0,
      professionalNetAmount: 0,
      cashCommissionDebtAmount: 0,
    });
  });
});

describe('selectMostRecentLedgerEventRows', () => {
  it('returns an empty array for no rows (pre-event)', () => {
    expect(selectMostRecentLedgerEventRows([])).toEqual([]);
  });

  it('returns every row when there is exactly one event', () => {
    const rows = [
      makeRow({ id: 'entry-1', type: LedgerEntryType.REFUND, amount: 1000 }),
      makeRow({
        id: 'entry-2',
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: 100,
      }),
    ];

    expect(selectMostRecentLedgerEventRows(rows)).toEqual(rows);
  });

  it('picks only the rows sharing the LATER createdAt when two distinct events exist, most-recent-first', () => {
    const later = new Date('2026-09-15T10:00:00.000Z');
    const earlier = new Date('2026-09-10T10:00:00.000Z');
    const rows = [
      makeRow({
        id: 'entry-refund',
        type: LedgerEntryType.REFUND,
        amount: 8000,
        createdAt: later,
      }),
      makeRow({
        id: 'entry-cash',
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: 800,
        createdAt: earlier,
      }),
    ];

    const result = selectMostRecentLedgerEventRows(rows);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('entry-refund');
  });
});
