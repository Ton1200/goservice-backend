import {
  MercadoPagoPaymentRecord,
  findPaymentRecordForOrder,
  mapPaymentRecordToDetails,
} from './mercadopago-payment-record.mapper';

/**
 * Trimmed copy of a REAL sandbox payment record (GOS-85, 2026-09-18, Colombia,
 * `visa` credit, 50.000 COP): the fee and both tax withholdings come from the
 * collector, and 50000 - 2912 - 207 - 750 = 46131 = the reported net. Personal
 * fields (cardholder, payer) are deliberately absent.
 */
const REAL_CARD_RECORD: MercadoPagoPaymentRecord = {
  payment_type_id: 'credit_card',
  payment_method_id: 'visa',
  card: { last_four_digits: '6260' },
  charges_details: [
    {
      type: 'fee',
      accounts: { from: 'collector', to: 'mp' },
      amounts: { original: 2912 },
    },
    {
      type: 'tax',
      accounts: { from: 'collector', to: 'mp' },
      amounts: { original: 207 },
    },
    {
      type: 'tax',
      accounts: { from: 'collector', to: 'mp' },
      amounts: { original: 750 },
    },
  ],
  fee_details: [
    { type: 'mercadopago_fee', fee_payer: 'collector', amount: 2912 },
  ],
  transaction_details: { net_received_amount: 46131 },
  date_approved: '2026-09-18T11:05:28.000-04:00',
  money_release_date: '2026-09-18T11:05:28.000-04:00',
  point_of_interaction: {
    references: [{ id: 'ORDTST01M2TGT3RDE8J8PRGS592D04YF' }],
  },
};

describe('mapPaymentRecordToDetails', () => {
  it('maps a real card payment: brand, last four, fee, taxes, net and dates', () => {
    expect(mapPaymentRecordToDetails(REAL_CARD_RECORD)).toEqual({
      paymentTypeId: 'credit_card',
      cardBrand: 'visa',
      cardLastFour: '6260',
      providerFeeAmount: 2912,
      providerTaxAmount: 957, // 207 + 750
      netReceivedAmount: 46131,
      approvedAt: new Date('2026-09-18T11:05:28.000-04:00'),
      moneyReleaseAt: new Date('2026-09-18T11:05:28.000-04:00'),
    });
  });

  it('keeps the numbers consistent: amount - fee - taxes = net', () => {
    const details = mapPaymentRecordToDetails(REAL_CARD_RECORD);
    expect(
      50000 - details.providerFeeAmount! - details.providerTaxAmount!,
    ).toBe(details.netReceivedAmount);
  });

  it('a debit card is a card too', () => {
    const details = mapPaymentRecordToDetails({
      ...REAL_CARD_RECORD,
      payment_type_id: 'debit_card',
      payment_method_id: 'debvisa',
    });
    expect(details).toMatchObject({
      paymentTypeId: 'debit_card',
      cardBrand: 'debvisa',
      cardLastFour: '6260',
    });
  });

  it('a payment made with ACCOUNT BALANCE has no card brand or last four', () => {
    const details = mapPaymentRecordToDetails({
      ...REAL_CARD_RECORD,
      payment_type_id: 'account_money',
      payment_method_id: 'account_money',
      card: {},
    });
    expect(details).toMatchObject({
      paymentTypeId: 'account_money',
      cardBrand: null,
      cardLastFour: null,
    });
  });

  it("does NOT count a charge the PAYER bears (e.g. instalment financing) as GoService's cost", () => {
    const details = mapPaymentRecordToDetails({
      ...REAL_CARD_RECORD,
      charges_details: [
        ...(REAL_CARD_RECORD.charges_details ?? []),
        {
          type: 'fee',
          accounts: { from: 'payer', to: 'mp' },
          amounts: { original: 9999 },
        },
      ],
    });
    expect(details.providerFeeAmount).toBe(2912);
  });

  it('falls back to fee_details (collector only) when charges_details is absent; taxes are then unknown', () => {
    const details = mapPaymentRecordToDetails({
      ...REAL_CARD_RECORD,
      charges_details: undefined,
    });
    expect(details.providerFeeAmount).toBe(2912);
    expect(details.providerTaxAmount).toBeNull();
  });

  it('rounds decimal amounts (ARS) to whole units', () => {
    const details = mapPaymentRecordToDetails({
      ...REAL_CARD_RECORD,
      charges_details: [
        {
          type: 'fee',
          accounts: { from: 'collector' },
          amounts: { original: 291.6 },
        },
      ],
      transaction_details: { net_received_amount: 4613.4 },
    });
    expect(details.providerFeeAmount).toBe(292);
    expect(details.netReceivedAmount).toBe(4613);
  });

  it.each([['123'], ['12345'], ['abcd'], [''], [undefined]])(
    'keeps ONLY a plain 4-digit last-four — %p is dropped, never stored',
    (lastFour) => {
      const details = mapPaymentRecordToDetails({
        ...REAL_CARD_RECORD,
        card: { last_four_digits: lastFour },
      });
      expect(details.cardLastFour).toBeNull();
    },
  );

  it('never surfaces cardholder or payer data, even if the record carries it', () => {
    const noisy = {
      ...REAL_CARD_RECORD,
      card: {
        last_four_digits: '6260',
        cardholder: { name: 'APRO', identification: { number: '123456789' } },
      },
      payer: { email: 'someone@example.com', phone: { number: '3001234567' } },
    } as MercadoPagoPaymentRecord;

    expect(JSON.stringify(mapPaymentRecordToDetails(noisy))).not.toMatch(
      /APRO|123456789|someone@example|3001234567/,
    );
  });

  it('tolerates a sparse record: everything unknown is null, nothing throws', () => {
    expect(mapPaymentRecordToDetails({})).toEqual({
      paymentTypeId: null,
      cardBrand: null,
      cardLastFour: null,
      providerFeeAmount: null,
      providerTaxAmount: null,
      netReceivedAmount: null,
      approvedAt: null,
      moneyReleaseAt: null,
    });
  });

  it('treats an unparseable date as unknown', () => {
    const details = mapPaymentRecordToDetails({
      ...REAL_CARD_RECORD,
      date_approved: 'not a date',
    });
    expect(details.approvedAt).toBeNull();
  });
});

describe('findPaymentRecordForOrder', () => {
  const other: MercadoPagoPaymentRecord = {
    point_of_interaction: { references: [{ id: 'ORD_OTHER' }] },
  };

  it('links by the EXACT order id in point_of_interaction.references', () => {
    expect(
      findPaymentRecordForOrder(
        [other, REAL_CARD_RECORD],
        'ORDTST01M2TGT3RDE8J8PRGS592D04YF',
      ),
    ).toBe(REAL_CARD_RECORD);
  });

  it('returns null when no record references the order — it never guesses by amount or date', () => {
    expect(findPaymentRecordForOrder([other], 'ORD_MISSING')).toBeNull();
    expect(findPaymentRecordForOrder([], 'ORD_MISSING')).toBeNull();
  });

  it('tolerates records with no references at all', () => {
    expect(
      findPaymentRecordForOrder([{}, { point_of_interaction: null }], 'ORD_X'),
    ).toBeNull();
  });
});
