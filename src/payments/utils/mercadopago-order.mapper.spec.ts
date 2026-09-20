import {
  formatMercadoPagoAmount,
  mapOrderStatus,
  mapOrderToSnapshot,
  mapRejectionReason,
  parseMercadoPagoAmount,
} from './mercadopago-order.mapper';

/**
 * The three fixtures below are trimmed copies of REAL sandbox responses
 * captured during the GOS-85 spike (2026-09-18, Colombia app): an approved
 * order (`201`), a declined order (the `data` node of a `402`), and a pending
 * order (`201`, test cardholder `CONT`). Card token / payer removed.
 */
const APPROVED_ORDER = {
  id: 'ORDTST01M2TGRCBJQ10ZGJG3JKJS5QQR',
  status: 'processed',
  status_detail: 'accredited',
  external_reference: 'engagement-1',
  total_amount: '50000',
  currency: 'COP',
  transactions: {
    payments: [
      {
        id: 'PAY01M2TGRCC1KWZ9JQ3JG082QGDC',
        status: 'processed',
        status_detail: 'accredited',
      },
    ],
  },
};

const DECLINED_ORDER = {
  id: 'ORDTST01M2THMHPEE3CDSSAJMQ6344XK',
  status: 'failed',
  status_detail: 'failed',
  external_reference: 'engagement-1',
  total_amount: '50000',
  currency: 'COP',
  transactions: {
    payments: [
      {
        id: 'PAY01M2THMHPWG1DPE1QYFXA0R6PD',
        status: 'failed',
        status_detail: 'insufficient_amount',
      },
    ],
  },
};

const PENDING_ORDER = {
  id: 'ORDTST01M2THMM51WYATRC91FY2PSJ9N',
  status: 'processing',
  status_detail: 'in_process',
  external_reference: 'engagement-1',
  total_amount: '50000',
  currency: 'COP',
  transactions: {
    payments: [
      {
        id: 'PAY01M2THMM5TA0V05DE76GABX087',
        status: 'processing',
        status_detail: 'in_process',
      },
    ],
  },
};

describe('formatMercadoPagoAmount', () => {
  it('formats COP as a zero-decimal string (the pattern Mercado Pago accepted live)', () => {
    expect(formatMercadoPagoAmount(50000, 'COP')).toBe('50000');
  });

  it('formats ARS with two decimals (documented form; not verified live)', () => {
    expect(formatMercadoPagoAmount(200, 'ARS')).toBe('200.00');
  });

  it('is case-insensitive on the currency code', () => {
    expect(formatMercadoPagoAmount(1000, 'cop')).toBe('1000');
  });
});

describe('parseMercadoPagoAmount', () => {
  it.each([
    ['50000', 50000],
    ['200.00', 200],
    [50000, 50000],
  ])('parses %p as %p', (raw, expected) => {
    expect(parseMercadoPagoAmount(raw)).toBe(expected);
  });

  it.each([[undefined], [null], ['abc'], [{}]])(
    'returns null for %p',
    (raw) => {
      expect(parseMercadoPagoAmount(raw)).toBeNull();
    },
  );
});

describe('mapOrderStatus', () => {
  it('maps processed + accredited to approved (live)', () => {
    expect(mapOrderStatus(APPROVED_ORDER)).toBe('approved');
  });

  it('maps failed to rejected (live)', () => {
    expect(mapOrderStatus(DECLINED_ORDER)).toBe('rejected');
  });

  it('maps processing / in_process to pending (live)', () => {
    expect(mapOrderStatus(PENDING_ORDER)).toBe('pending');
  });

  it.each([['canceled'], ['expired']])(
    'maps documented terminal state %s to rejected',
    (status) => {
      expect(mapOrderStatus({ status })).toBe('rejected');
    },
  );

  it.each([['created'], ['action_required'], ['something_new']])(
    'maps open/unknown state %s to pending — never approved or rejected',
    (status) => {
      expect(mapOrderStatus({ status })).toBe('pending');
    },
  );

  it('does NOT treat processed without accredited as paid', () => {
    expect(
      mapOrderStatus({
        status: 'processed',
        status_detail: 'partially_refunded',
      }),
    ).toBe('pending');
  });

  it('is case-insensitive', () => {
    expect(
      mapOrderStatus({ status: 'PROCESSED', status_detail: 'ACCREDITED' }),
    ).toBe('approved');
  });
});

describe('mapRejectionReason', () => {
  it.each([
    ['insufficient_amount', 'INSUFFICIENT_FUNDS'], // live, cardholder FUND
    ['rejected_by_issuer', 'CARD_DECLINED'], // live, cardholder OTHE
    ['rejected_high_risk', 'CARD_DECLINED'],
    ['card_disabled', 'CARD_DECLINED'],
    ['bad_filled_security_code', 'INVALID_CARD_DATA'],
    ['bad_filled_date', 'INVALID_CARD_DATA'],
    ['something_unrecognised', 'OTHER'],
    [undefined, 'OTHER'],
  ])('maps %p to %s', (detail, expected) => {
    expect(mapRejectionReason(detail)).toBe(expected);
  });
});

describe('mapOrderToSnapshot', () => {
  it('maps an approved order, carrying the correlation + amount fields', () => {
    expect(mapOrderToSnapshot(APPROVED_ORDER)).toEqual({
      providerPaymentId: 'ORDTST01M2TGRCBJQ10ZGJG3JKJS5QQR',
      status: 'approved',
      externalReference: 'engagement-1',
      amount: 50000,
      currency: 'COP',
    });
  });

  it('takes the rejection reason from the PAYMENT detail, not the order-level `failed`', () => {
    expect(mapOrderToSnapshot(DECLINED_ORDER)).toMatchObject({
      providerPaymentId: 'ORDTST01M2THMHPEE3CDSSAJMQ6344XK',
      status: 'rejected',
      rejectionReason: 'INSUFFICIENT_FUNDS',
    });
  });

  it('maps a pending order with no rejection reason', () => {
    const snapshot = mapOrderToSnapshot(PENDING_ORDER);
    expect(snapshot).toMatchObject({ status: 'pending' });
    expect(snapshot).not.toHaveProperty('rejectionReason');
  });

  it('returns null for a body with no order id', () => {
    expect(mapOrderToSnapshot({ status: 'processed' })).toBeNull();
  });
});

describe('mapOrderToSnapshot — malformed wire bodies', () => {
  it.each([[null], [undefined], ['a string'], [42]])(
    'returns null (never throws) for a %p body',
    (body) => {
      expect(mapOrderToSnapshot(body as never)).toBeNull();
    },
  );
});
