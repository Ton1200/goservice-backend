import { mapMercadoPagoStoredCard } from './mercadopago-stored-card.mapper';

describe('mapMercadoPagoStoredCard', () => {
  it('maps a full Mercado Pago stored card, deriving brand from payment_method.id', () => {
    expect(
      mapMercadoPagoStoredCard({
        id: 'card_1',
        last_four_digits: '1111',
        expiration_month: 12,
        expiration_year: 2030,
        payment_method: { id: 'visa', payment_type_id: 'credit_card' },
      }),
    ).toEqual({
      providerCardId: 'card_1',
      brand: 'visa',
      lastFour: '1111',
      type: 'credit_card',
      expirationMonth: 12,
      expirationYear: 2030,
    });
  });

  it('maps a debit card the same way', () => {
    expect(
      mapMercadoPagoStoredCard({
        id: 'card_2',
        payment_method: { id: 'master', payment_type_id: 'debit_card' },
      }),
    ).toMatchObject({ type: 'debit_card', brand: 'master' });
  });

  it('a payment_type_id that is neither credit nor debit maps to a null type', () => {
    expect(
      mapMercadoPagoStoredCard({
        id: 'card_3',
        payment_method: { id: 'visa', payment_type_id: 'prepaid_card' },
      }),
    ).toMatchObject({ type: null });
  });

  it('is null-safe for a missing payment_method entirely', () => {
    expect(mapMercadoPagoStoredCard({ id: 'card_4' })).toEqual({
      providerCardId: 'card_4',
      brand: null,
      lastFour: null,
      type: null,
      expirationMonth: null,
      expirationYear: null,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a non-object', 'card_1'],
    ['an object with no id', { last_four_digits: '1111' }],
  ])('returns null for %s', (_label, input) => {
    expect(mapMercadoPagoStoredCard(input)).toBeNull();
  });
});
