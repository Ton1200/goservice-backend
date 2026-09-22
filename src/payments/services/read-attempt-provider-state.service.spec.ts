import { CountryCode, PaymentMethod } from '@prisma/client';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { ReadAttemptProviderStateService } from './read-attempt-provider-state.service';

function makeAttempt(overrides?: Record<string, unknown>) {
  return {
    id: 'attempt-1',
    engagementId: 'engagement-1',
    method: PaymentMethod.RAPYD,
    providerPaymentId: null,
    providerCheckoutId: null,
    ...overrides,
  } as never;
}

describe("ReadAttemptProviderStateService — dispatch by the ATTEMPT's method", () => {
  function makeService(options?: {
    capabilities?: string[];
    readPayment?: jest.Mock;
    getCheckoutSnapshot?: jest.Mock;
    readSavedCardCharge?: jest.Mock;
  }) {
    const readPayment = options?.readPayment ?? jest.fn();
    const getCheckoutSnapshot = options?.getCheckoutSnapshot ?? jest.fn();
    const readSavedCardCharge = options?.readSavedCardCharge ?? jest.fn();
    const provider = {
      capabilities: new Set(options?.capabilities ?? ['EMBEDDED_CHECKOUT']),
      readPayment,
      getCheckoutSnapshot,
      readSavedCardCharge,
    };
    const forMethod = jest.fn().mockReturnValue(provider);
    const embeddedCheckout = jest.fn().mockReturnValue(provider);
    const savedCards = jest.fn().mockReturnValue(provider);
    const registry = {
      forMethod,
      embeddedCheckout,
      savedCards,
    } as unknown as PaymentProviderRegistry;
    return {
      service: new ReadAttemptProviderStateService(registry),
      readPayment,
      getCheckoutSnapshot,
      readSavedCardCharge,
      forMethod,
      embeddedCheckout,
      savedCards,
    };
  }

  it('reads an attempt that has a checkout id THROUGH THE CHECKOUT — even with no payment id yet', async () => {
    const m = makeService({
      getCheckoutSnapshot: jest.fn().mockResolvedValue({
        checkoutId: 'checkout_1',
        status: 'pending',
        providerPaymentId: null,
        paymentCreated: false,
        open: true,
        externalReference: 'engagement-1',
        amount: 50000,
        currency: 'ARS',
      }),
    });

    const state = await m.service.read(
      makeAttempt({ providerCheckoutId: 'checkout_1' }),
      CountryCode.AR,
    );

    expect(m.forMethod).toHaveBeenCalledWith(PaymentMethod.RAPYD);
    expect(m.embeddedCheckout).toHaveBeenCalledWith(PaymentMethod.RAPYD);
    expect(m.getCheckoutSnapshot).toHaveBeenCalledWith('checkout_1', 'AR');
    expect(m.readPayment).not.toHaveBeenCalled();
    expect(state).toEqual({
      status: 'pending',
      rejectionReason: undefined,
      providerPaymentId: null,
      externalReference: 'engagement-1',
      amount: 50000,
      currency: 'ARS',
      paymentCreated: false,
      open: true,
    });
  });

  it('reads a provider WITHOUT an embedded checkout (Mercado Pago) by its payment id — the provider picks its own API', async () => {
    const m = makeService({
      capabilities: ['CARD_TOKEN', 'WALLET_REDIRECT'],
      readPayment: jest.fn().mockResolvedValue({
        providerPaymentId: 'ORD_1',
        status: 'approved',
        externalReference: 'engagement-1',
        amount: 50000,
        currency: 'COP',
      }),
    });

    const state = await m.service.read(
      makeAttempt({
        method: PaymentMethod.MERCADOPAGO,
        providerPaymentId: 'ORD_1',
      }),
      CountryCode.CO,
    );

    expect(m.forMethod).toHaveBeenCalledWith(PaymentMethod.MERCADOPAGO);
    expect(m.readPayment).toHaveBeenCalledWith('ORD_1', 'CO');
    expect(m.getCheckoutSnapshot).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      status: 'approved',
      providerPaymentId: 'ORD_1',
      paymentCreated: true,
      open: false,
    });
  });

  it('a payment id with NO checkout is a server-side saved-card charge: it is re-read terminal-aware, so a failed charge does not stay PENDING forever', async () => {
    const m = makeService({
      capabilities: ['EMBEDDED_CHECKOUT', 'SAVED_CARDS'],
      readSavedCardCharge: jest.fn().mockResolvedValue({
        providerPaymentId: 'payment_1',
        status: 'rejected',
        rejectionReason: 'CARD_DECLINED',
        externalReference: 'engagement-1',
        amount: 50000,
        currency: 'ARS',
      }),
    });

    const state = await m.service.read(
      makeAttempt({ providerPaymentId: 'payment_1' }),
      CountryCode.AR,
    );

    expect(m.savedCards).toHaveBeenCalledWith(PaymentMethod.RAPYD);
    expect(m.readSavedCardCharge).toHaveBeenCalledWith('payment_1');
    expect(m.readPayment).not.toHaveBeenCalled();
    expect(m.getCheckoutSnapshot).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      status: 'rejected',
      rejectionReason: 'CARD_DECLINED',
      providerPaymentId: 'payment_1',
    });
  });

  it('a checkout id is ignored for a provider without embedded checkouts', async () => {
    const m = makeService({
      capabilities: ['CARD_TOKEN'],
      readPayment: jest.fn().mockResolvedValue(null),
    });

    await m.service.read(
      makeAttempt({
        method: PaymentMethod.MERCADOPAGO,
        providerCheckoutId: 'checkout_1',
        providerPaymentId: 'ORD_1',
      }),
      CountryCode.CO,
    );

    expect(m.getCheckoutSnapshot).not.toHaveBeenCalled();
    expect(m.readPayment).toHaveBeenCalledWith('ORD_1', 'CO');
  });

  it('has nothing to re-read for an attempt with neither id', async () => {
    const m = makeService();

    await expect(
      m.service.read(makeAttempt(), CountryCode.AR),
    ).resolves.toBeNull();
    expect(m.readPayment).not.toHaveBeenCalled();
    expect(m.getCheckoutSnapshot).not.toHaveBeenCalled();
  });

  it('resolves null when the provider does not know the checkout / payment', async () => {
    const m = makeService({
      getCheckoutSnapshot: jest.fn().mockResolvedValue(null),
    });

    await expect(
      m.service.read(
        makeAttempt({ providerCheckoutId: 'checkout_1' }),
        CountryCode.AR,
      ),
    ).resolves.toBeNull();
  });

  it('lets provider errors propagate — each caller decides whether that is best-effort', async () => {
    const m = makeService({
      getCheckoutSnapshot: jest.fn().mockRejectedValue(new Error('boom')),
    });

    await expect(
      m.service.read(
        makeAttempt({ providerCheckoutId: 'checkout_1' }),
        CountryCode.AR,
      ),
    ).rejects.toThrow('boom');
  });
});
