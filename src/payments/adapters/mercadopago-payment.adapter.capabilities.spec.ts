import { CountryCode, PaymentMethod } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { MercadoPagoPaymentAdapter } from './mercadopago-payment.adapter';

// GOS-146 — the multi-provider additions to `MercadoPagoPaymentAdapter`
// (`method`, `capabilities`, `isConfigured`, `isWalletConfigured`,
// `readPayment`). Its charge/wallet behavior is covered, unchanged, by
// `mercadopago-payment.adapter.spec.ts`.
describe('MercadoPagoPaymentAdapter — multi-provider surface (GOS-146)', () => {
  function makeAdapter(settings: Record<string, string | null>) {
    const getValue = jest.fn((key: string) =>
      Promise.resolve(settings[key] ?? null),
    );
    const adapter = new MercadoPagoPaymentAdapter({
      getValue,
    } as unknown as PlatformSettingPort);
    return adapter;
  }

  it('is the MERCADOPAGO provider with the card-token and wallet-redirect capabilities — and NOT the embedded checkout', () => {
    const adapter = makeAdapter({});

    expect(adapter.method).toBe(PaymentMethod.MERCADOPAGO);
    expect([...adapter.capabilities].sort()).toEqual([
      'CARD_TOKEN',
      'WALLET_REDIRECT',
    ]);
  });

  it('isConfigured needs the access token AND a valid environment for THAT country', async () => {
    const adapter = makeAdapter({
      'payments.payment-methods.mercadopago.ar.access-token': 'APP_USR-fake',
      'payments.payment-methods.mercadopago.ar.environment': 'sandbox',
      'payments.payment-methods.mercadopago.co.access-token': 'APP_USR-fake',
    });

    await expect(adapter.isConfigured(CountryCode.AR)).resolves.toBe(true);
    await expect(adapter.isConfigured(CountryCode.CO)).resolves.toBe(false); // no environment
  });

  it('isWalletConfigured additionally needs the public base URL and the three back URLs', async () => {
    const base = {
      'payments.general-settings.callbacks.public-base-url':
        'https://api.goservice.example',
      'payments.payment-methods.mercadopago.wallet.back-url-success':
        'https://app/ok',
      'payments.payment-methods.mercadopago.wallet.back-url-pending':
        'https://app/wait',
      'payments.payment-methods.mercadopago.wallet.back-url-failure':
        'https://app/ko',
    };

    await expect(
      makeAdapter(base).isWalletConfigured(CountryCode.AR),
    ).resolves.toBe(true);
    await expect(
      makeAdapter({
        ...base,
        'payments.payment-methods.mercadopago.wallet.back-url-failure': null,
      }).isWalletConfigured(CountryCode.AR),
    ).resolves.toBe(false);
    await expect(
      makeAdapter({
        ...base,
        'payments.general-settings.callbacks.public-base-url': null,
      }).isWalletConfigured(CountryCode.AR),
    ).resolves.toBe(false);
  });

  describe('readPayment — dispatches to the right Mercado Pago API by the id it was given', () => {
    it('a purely numeric id is a legacy Payments API id (the wallet flow)', async () => {
      const adapter = makeAdapter({});
      const byPaymentId = jest
        .spyOn(adapter, 'getPaymentByPaymentId')
        .mockResolvedValue(null);
      const byOrder = jest.spyOn(adapter, 'getPayment').mockResolvedValue(null);

      await adapter.readPayment('178687128941', CountryCode.CO);

      expect(byPaymentId).toHaveBeenCalledWith('178687128941', CountryCode.CO);
      expect(byOrder).not.toHaveBeenCalled();
    });

    it('anything else is an Orders API id (the card flow)', async () => {
      const adapter = makeAdapter({});
      const byPaymentId = jest
        .spyOn(adapter, 'getPaymentByPaymentId')
        .mockResolvedValue(null);
      const byOrder = jest.spyOn(adapter, 'getPayment').mockResolvedValue(null);

      await adapter.readPayment('ORD01K5EXAMPLE', CountryCode.CO);

      expect(byOrder).toHaveBeenCalledWith('ORD01K5EXAMPLE', CountryCode.CO);
      expect(byPaymentId).not.toHaveBeenCalled();
    });
  });
});
