import { resolveMercadoPagoPaymentType } from './mercadopago-payment-type.util';

describe('resolveMercadoPagoPaymentType', () => {
  it.each([['debvisa'], ['debmaster'], ['DEBVISA'], ['DebMaster']])(
    'maps the debit id %s to debit_card',
    (id) => {
      expect(resolveMercadoPagoPaymentType(id)).toBe('debit_card');
    },
  );

  it.each([['visa'], ['master'], ['amex'], ['diners'], ['codensa']])(
    'maps the credit id %s to credit_card',
    (id) => {
      expect(resolveMercadoPagoPaymentType(id)).toBe('credit_card');
    },
  );

  it('does NOT treat an unknown "deb..." id as debit — an allow-list, not a prefix match', () => {
    expect(resolveMercadoPagoPaymentType('debcabal')).toBe('credit_card');
    expect(resolveMercadoPagoPaymentType('debit')).toBe('credit_card');
  });
});
