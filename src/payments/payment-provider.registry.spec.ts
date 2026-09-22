import { PaymentMethod } from '@prisma/client';
import { MercadoPagoPaymentAdapter } from './adapters/mercadopago-payment.adapter';
import { RapydPaymentAdapter } from './adapters/rapyd-payment.adapter';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentProviderCapabilityError } from './ports/payment-provider.port';

describe('PaymentProviderRegistry', () => {
  const mercadoPago = new MercadoPagoPaymentAdapter({} as never);
  const rapyd = new RapydPaymentAdapter({} as never);
  const registry = new PaymentProviderRegistry(mercadoPago, rapyd);

  it('resolves each provider method to ITS OWN adapter', () => {
    expect(registry.forMethod(PaymentMethod.MERCADOPAGO)).toBe(mercadoPago);
    expect(registry.forMethod(PaymentMethod.RAPYD)).toBe(rapyd);
  });

  it('fails explicitly for a method with no adapter — CASH is not a provider', () => {
    expect(() => registry.forMethod(PaymentMethod.CASH)).toThrow(
      PaymentProviderCapabilityError,
    );
  });

  it('serves the capabilities each provider really has', () => {
    expect(registry.cardToken(PaymentMethod.MERCADOPAGO)).toBe(mercadoPago);
    expect(registry.walletRedirect(PaymentMethod.MERCADOPAGO)).toBe(
      mercadoPago,
    );
    expect(registry.embeddedCheckout(PaymentMethod.RAPYD)).toBe(rapyd);
    expect(registry.savedCards(PaymentMethod.RAPYD)).toBe(rapyd);
  });

  it.each([
    ['cardToken', PaymentMethod.RAPYD, 'CARD_TOKEN'],
    ['walletRedirect', PaymentMethod.RAPYD, 'WALLET_REDIRECT'],
    ['embeddedCheckout', PaymentMethod.MERCADOPAGO, 'EMBEDDED_CHECKOUT'],
    // Mercado Pago has no reusable card token (why GOS-83 was dropped).
    ['savedCards', PaymentMethod.MERCADOPAGO, 'SAVED_CARDS'],
  ] as const)(
    'fails explicitly when %s is asked of %s, which lacks that capability',
    (accessor, method, capability) => {
      expect(() => registry[accessor](method)).toThrow(
        new PaymentProviderCapabilityError(method, capability),
      );
    },
  );

  it('lists every registered provider', () => {
    expect(registry.all()).toEqual([mercadoPago, rapyd]);
  });
});
