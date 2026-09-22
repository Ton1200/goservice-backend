import {
  isRapydCheckoutId,
  isRapydPaymentId,
  mapCheckoutToSnapshot,
  mapPaymentToDetails,
  mapPaymentToSnapshot,
  isRapydCustomerId,
  isRapydStoredCardId,
  mapRapydFailureCode,
  mapRapydStoredCard,
  mapSavedCardCharge,
  unwrapRapydData,
  unwrapRapydList,
} from './rapyd-checkout.mapper';

// Shapes mirror what the GOS-75 PoC saved/observed live (a `NEW` checkout with
// an empty nested payment; `DON` + `CLO`/`paid:true` after a payment; `ACT`
// awaiting 3DS) plus the documented `EXP`/`INP`/`DEC` checkout statuses.
const NEW_CHECKOUT = {
  id: 'checkout_447f948acde2a1dc0f85eb290e524f78',
  status: 'NEW',
  amount: 50000,
  currency: 'ARS',
  merchant_reference_id: 'engagement-1',
  payment: {
    id: null,
    status: null,
    paid: false,
    amount: 50000,
    currency_code: 'ARS',
    merchant_reference_id: null,
  },
};

const PAID_PAYMENT = {
  id: 'payment_06145770edff02c9eb714d9d2f7c7245',
  status: 'CLO',
  paid: true,
  amount: 50000,
  currency_code: 'ARS',
  merchant_reference_id: 'engagement-1',
};

describe('id shapes', () => {
  it('recognizes only Rapyd checkout_ / payment_ ids (they end up in a URL path)', () => {
    expect(isRapydCheckoutId('checkout_abc123')).toBe(true);
    expect(isRapydCheckoutId('payment_abc123')).toBe(false);
    expect(isRapydCheckoutId('checkout_../../v1/payments')).toBe(false);
    expect(isRapydPaymentId('payment_abc123')).toBe(true);
    expect(isRapydPaymentId('checkout_abc123')).toBe(false);
    expect(isRapydPaymentId('payment_a/../b')).toBe(false);
  });
});

describe('unwrapRapydData', () => {
  it('returns the data node of the { status, data } envelope, or null', () => {
    expect(
      unwrapRapydData({ status: { status: 'SUCCESS' }, data: { id: 1 } }),
    ).toEqual({ id: 1 });
    expect(unwrapRapydData(null)).toBeNull();
    expect(unwrapRapydData({ status: {}, data: 'x' })).toBeNull();
    expect(unwrapRapydData({ status: {} })).toBeNull();
  });
});

describe('mapCheckoutToSnapshot — the CHECKOUT decides', () => {
  it('a fresh NEW checkout with no payment is PENDING, open, no payment created', () => {
    expect(mapCheckoutToSnapshot(NEW_CHECKOUT)).toEqual({
      checkoutId: NEW_CHECKOUT.id,
      status: 'pending',
      providerPaymentId: null,
      paymentCreated: false,
      open: true,
      externalReference: 'engagement-1',
      amount: 50000,
      currency: 'ARS',
    });
  });

  it('DON + a CLO/paid payment is APPROVED, with the PAID payment amount/currency and id', () => {
    const snapshot = mapCheckoutToSnapshot({
      ...NEW_CHECKOUT,
      status: 'DON',
      payment: PAID_PAYMENT,
    });

    expect(snapshot).toMatchObject({
      status: 'approved',
      providerPaymentId: PAID_PAYMENT.id,
      paymentCreated: true,
      open: false,
      amount: 50000,
      currency: 'ARS',
    });
  });

  it('a CLO payment that is NOT paid:true is not approved — an unrecognized state never moves money', () => {
    const snapshot = mapCheckoutToSnapshot({
      ...NEW_CHECKOUT,
      status: 'DON',
      payment: { ...PAID_PAYMENT, paid: false },
    });

    expect(snapshot?.status).toBe('pending');
  });

  it('an ACT payment awaiting 3D Secure is PENDING with a payment created, and the checkout still open', () => {
    const snapshot = mapCheckoutToSnapshot({
      ...NEW_CHECKOUT,
      status: 'INP',
      payment: { ...PAID_PAYMENT, status: 'ACT', paid: false },
    });

    expect(snapshot).toMatchObject({
      status: 'pending',
      paymentCreated: true,
      open: true,
    });
  });

  it('a FAILED payment inside a still-open checkout is PENDING, not rejected — the widget lets the Customer retry, so closing the attempt would lose a later successful retry', () => {
    const snapshot = mapCheckoutToSnapshot({
      ...NEW_CHECKOUT,
      status: 'NEW',
      payment: {
        ...PAID_PAYMENT,
        status: 'ERR',
        paid: false,
        failure_code: 'ERROR_CARD_DECLINED',
      },
    });

    expect(snapshot).toMatchObject({ status: 'pending', open: true });
    expect(snapshot).not.toHaveProperty('rejectionReason');
  });

  it.each([['EXP'], ['DEC']])(
    'a %s checkout with no paid payment is REJECTED and no longer open',
    (status) => {
      const snapshot = mapCheckoutToSnapshot({ ...NEW_CHECKOUT, status });

      expect(snapshot).toMatchObject({
        status: 'rejected',
        open: false,
        rejectionReason: 'OTHER',
      });
    },
  );

  it('an EXP checkout that was in fact paid stays APPROVED — payment wins over checkout status', () => {
    const snapshot = mapCheckoutToSnapshot({
      ...NEW_CHECKOUT,
      status: 'EXP',
      payment: PAID_PAYMENT,
    });

    expect(snapshot?.status).toBe('approved');
  });

  it('rounds a decimal amount to whole major units (Rapyd can answer decimals — ARS)', () => {
    const snapshot = mapCheckoutToSnapshot({
      ...NEW_CHECKOUT,
      status: 'DON',
      payment: { ...PAID_PAYMENT, amount: '50000.00' },
    });

    expect(snapshot?.amount).toBe(50000);
  });

  it.each([
    [null],
    [undefined],
    [{}],
    [{ id: 'payment_wrong_shape' }],
    [{ id: null }],
  ])('returns null for a body with no usable checkout id (%j)', (input) => {
    expect(mapCheckoutToSnapshot(input as never)).toBeNull();
  });
});

describe('mapPaymentToSnapshot', () => {
  it('CLO + paid:true is APPROVED', () => {
    expect(mapPaymentToSnapshot(PAID_PAYMENT)).toEqual({
      providerPaymentId: PAID_PAYMENT.id,
      status: 'approved',
      externalReference: 'engagement-1',
      amount: 50000,
      currency: 'ARS',
    });
  });

  it.each([['ACT'], ['ERR'], ['CAN'], ['EXP'], ['REV'], ['WHATEVER']])(
    'a %s payment is PENDING — a payment-level failure never rejects a Rapyd attempt (only the checkout can)',
    (status) => {
      expect(
        mapPaymentToSnapshot({ ...PAID_PAYMENT, status, paid: false })?.status,
      ).toBe('pending');
    },
  );

  it('returns null for a body with no usable payment id', () => {
    expect(mapPaymentToSnapshot(null)).toBeNull();
    expect(mapPaymentToSnapshot({ id: 'checkout_1' })).toBeNull();
  });
});

describe('mapRapydFailureCode', () => {
  it.each([
    ['ERROR_INSUFFICIENT_FUNDS', 'INSUFFICIENT_FUNDS'],
    ['ERROR_CARD_DECLINED', 'CARD_DECLINED'],
    ['DO_NOT_HONOR', 'CARD_DECLINED'],
    ['ERROR_INVALID_CARD_NUMBER', 'INVALID_CARD_DATA'],
    ['SOMETHING_UNSEEN', 'OTHER'],
    [null, 'OTHER'],
    [undefined, 'OTHER'],
  ])('%s -> %s (raw codes never leak, unknown is OTHER)', (code, expected) => {
    expect(mapRapydFailureCode(code)).toBe(expected);
  });
});

describe('mapPaymentToDetails — best effort, every field nullable', () => {
  it('reads brand, last four and card type when Rapyd reports them', () => {
    const details = mapPaymentToDetails({
      ...PAID_PAYMENT,
      paid_at: 1789585100,
      payment_method_data: {
        last4: '1111',
        // The REAL shape (verified live): `type`/`brand` on `bin_details`.
        bin_details: { brand: 'VISA', type: 'CREDIT' },
      },
    });

    expect(details).toMatchObject({
      paymentTypeId: 'credit_card',
      cardBrand: 'visa',
      cardLastFour: '1111',
      providerFeeAmount: null,
      providerTaxAmount: null,
      netReceivedAmount: null,
      moneyReleaseAt: null,
    });
    expect(details.approvedAt).toEqual(new Date(1789585100 * 1000));
  });

  it('maps a DEBIT card type to debit_card', () => {
    expect(
      mapPaymentToDetails({
        ...PAID_PAYMENT,
        payment_method_data: { bin_details: { type: 'DEBIT', brand: 'VISA' } },
      }).paymentTypeId,
    ).toBe('debit_card');
  });

  it('nulls everything Rapyd does not report — and never keeps a last-four that is not exactly 4 digits', () => {
    const details = mapPaymentToDetails({
      ...PAID_PAYMENT,
      payment_method_data: { last4: '41111111' },
    });

    expect(details).toMatchObject({
      paymentTypeId: null,
      cardBrand: null,
      cardLastFour: null,
      approvedAt: null,
    });
  });

  it('survives a payment with no payment_method_data at all', () => {
    expect(() => mapPaymentToDetails(PAID_PAYMENT)).not.toThrow();
  });
});

describe('saved cards — ids and list unwrapping (GOS-146)', () => {
  it('recognizes customer and stored-card ids and nothing else', () => {
    expect(isRapydCustomerId('cus_b56b811068f7ca71dbf68e87a1411f29')).toBe(
      true,
    );
    expect(isRapydCustomerId('cus_../x')).toBe(false);
    expect(isRapydCustomerId('card_1')).toBe(false);
    expect(isRapydStoredCardId('card_43084046ed2ecdf8b2dbc082e6e83ab3')).toBe(
      true,
    );
    expect(isRapydStoredCardId('other_1')).toBe(false);
    expect(isRapydStoredCardId('')).toBe(false);
  });

  it('unwrapRapydList returns the ARRAY in `data`, [] for anything else', () => {
    expect(unwrapRapydList({ data: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
    expect(unwrapRapydList({ data: { id: 'a' } })).toEqual([]);
    expect(unwrapRapydList(null)).toEqual([]);
  });
});

describe('mapRapydStoredCard — non-sensitive facts only', () => {
  // Trimmed copy of a card observed LIVE in the GOS-146 sandbox run.
  const LIVE_CARD = {
    id: 'card_43084046ed2ecdf8b2dbc082e6e83ab3',
    category: 'card',
    name: 'GOS146 Vault',
    last4: '1111',
    bin_details: { type: 'DEBIT', brand: 'VISA' },
    expiration_year: '30',
    expiration_month: '12',
    fingerprint_token: 'secret-ish',
  };

  it('maps the live shape: brand lowercased, type, last four, a TWO-digit year read as 20xx', () => {
    expect(mapRapydStoredCard(LIVE_CARD)).toEqual({
      providerCardId: 'card_43084046ed2ecdf8b2dbc082e6e83ab3',
      brand: 'visa',
      lastFour: '1111',
      type: 'debit_card',
      expirationMonth: 12,
      expirationYear: 2030,
    });
  });

  it('never exposes the holder name or the fingerprint token', () => {
    expect(JSON.stringify(mapRapydStoredCard(LIVE_CARD))).not.toMatch(
      /GOS146 Vault|secret-ish/,
    );
  });

  it('accepts a four-digit year and CREDIT', () => {
    expect(
      mapRapydStoredCard({
        ...LIVE_CARD,
        expiration_year: '2031',
        bin_details: { type: 'CREDIT', brand: 'MASTERCARD' },
      }),
    ).toMatchObject({
      type: 'credit_card',
      expirationYear: 2031,
      brand: 'mastercard',
    });
  });

  it('every unknown fact is null — a wrong guess costs a null, never a card', () => {
    expect(
      mapRapydStoredCard({
        id: 'card_1',
        last4: '12',
        expiration_month: '13',
        expiration_year: 'xx',
      }),
    ).toEqual({
      providerCardId: 'card_1',
      brand: null,
      lastFour: null,
      type: null,
      expirationMonth: null,
      expirationYear: null,
    });
  });

  it('drops anything that is not a card token', () => {
    expect(mapRapydStoredCard(null)).toBeNull();
    expect(
      mapRapydStoredCard({ id: 'bank_1', category: 'bank_transfer' }),
    ).toBeNull();
    expect(
      mapRapydStoredCard({ id: 'card_1', category: 'ewallet' }),
    ).toBeNull();
    expect(mapRapydStoredCard({ id: 'nope' })).toBeNull();
  });
});

describe('mapSavedCardCharge — a server-side charge has nobody to retry it, so failures are terminal', () => {
  const BASE = {
    id: 'payment_06145770edff02c9eb714d9d2f7c7245',
    amount: 50000,
    currency_code: 'ARS',
    merchant_reference_id: 'engagement-1',
  };

  it('CLO + paid:true is approved', () => {
    expect(mapSavedCardCharge({ ...BASE, status: 'CLO', paid: true })).toEqual({
      providerPaymentId: BASE.id,
      status: 'approved',
      externalReference: 'engagement-1',
      amount: 50000,
      currency: 'ARS',
    });
  });

  it.each([['ERR'], ['CAN'], ['EXP']])(
    'a %s payment is REJECTED (unlike inside a checkout)',
    (status) => {
      expect(
        mapSavedCardCharge({
          ...BASE,
          status,
          paid: false,
          failure_code: 'ERROR_CARD_DECLINED',
        }),
      ).toMatchObject({ status: 'rejected', rejectionReason: 'CARD_DECLINED' });
    },
  );

  it('ACT awaiting 3D Secure is rejected AUTHENTICATION_REQUIRED', () => {
    expect(
      mapSavedCardCharge({
        ...BASE,
        status: 'ACT',
        paid: false,
        next_action: '3d_verification',
      }),
    ).toMatchObject({
      status: 'rejected',
      rejectionReason: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('ACT for any other reason, CLO without paid, or an unknown status stays pending — an unrecognized state never moves money nor closes an attempt', () => {
    for (const payment of [
      { ...BASE, status: 'ACT', paid: false },
      { ...BASE, status: 'CLO', paid: false },
      { ...BASE, status: 'WHATEVER', paid: false },
    ]) {
      expect(mapSavedCardCharge(payment)?.status).toBe('pending');
    }
  });

  it('returns null for a body with no usable payment id', () => {
    expect(mapSavedCardCharge(null)).toBeNull();
    expect(mapSavedCardCharge({ id: 'checkout_1' })).toBeNull();
  });
});
