import type { CreateWalletPreferenceCommand } from '../ports/payment-provider.port';
import {
  buildWalletPreferenceRequest,
  mapPreferenceResponse,
} from './mercadopago-preference.mapper';

const COMMAND: CreateWalletPreferenceCommand = {
  amount: 50000,
  currency: 'COP',
  country: 'CO',
  description: 'Engagement payment',
  externalReference: 'engagement-1',
  payerEmail: 'buyer@example.com',
};

const BACK_URLS = {
  success: 'https://app.goservice.example/payments/success',
  pending: 'https://app.goservice.example/payments/pending',
  failure: 'https://app.goservice.example/payments/failure',
};

const NOTIFICATION_URL =
  'https://api.goservice.example/webhooks/mercadopago/payments/co';

describe('buildWalletPreferenceRequest', () => {
  it('builds a wallet_purchase preference with unit_price as a PLAIN INTEGER (live-verified format, GOS-142 spike)', () => {
    expect(
      buildWalletPreferenceRequest(COMMAND, BACK_URLS, NOTIFICATION_URL),
    ).toEqual({
      items: [
        {
          title: 'Engagement payment',
          quantity: 1,
          currency_id: 'COP',
          unit_price: 50000,
        },
      ],
      purpose: 'wallet_purchase',
      external_reference: 'engagement-1',
      payer: { email: 'buyer@example.com' },
      back_urls: BACK_URLS,
      notification_url: NOTIFICATION_URL,
    });
  });

  it('does NOT apply the Orders API zero-decimal-string convention — the amount passes straight through', () => {
    const body = buildWalletPreferenceRequest(
      { ...COMMAND, amount: 1234 },
      BACK_URLS,
      NOTIFICATION_URL,
    );
    expect(body.items[0].unit_price).toBe(1234);
    expect(typeof body.items[0].unit_price).toBe('number');
  });

  it('uppercases the currency code', () => {
    const body = buildWalletPreferenceRequest(
      { ...COMMAND, currency: 'cop' },
      BACK_URLS,
      NOTIFICATION_URL,
    );
    expect(body.items[0].currency_id).toBe('COP');
  });
});

describe('mapPreferenceResponse', () => {
  const RESPONSE = {
    id: '1534142261-abc12345-6789-def0-1234-56789abcdef0',
    init_point: 'https://www.mercadopago.com/checkout/v1/redirect?pref_id=x',
    sandbox_init_point:
      'https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=x',
  };

  it('returns sandbox_init_point under sandbox — the only URL that actually completes a TEST transaction (live-verified)', () => {
    expect(mapPreferenceResponse(RESPONSE, 'sandbox')).toEqual({
      preferenceId: RESPONSE.id,
      redirectUrl: RESPONSE.sandbox_init_point,
    });
  });

  it('returns init_point under production — never sandbox_init_point', () => {
    expect(mapPreferenceResponse(RESPONSE, 'production')).toEqual({
      preferenceId: RESPONSE.id,
      redirectUrl: RESPONSE.init_point,
    });
  });

  it('returns null when the response has no id', () => {
    expect(
      mapPreferenceResponse(
        { init_point: 'https://x', sandbox_init_point: 'https://y' },
        'sandbox',
      ),
    ).toBeNull();
  });

  it('returns null when the environment-appropriate URL is missing, even if the OTHER one is present', () => {
    expect(
      mapPreferenceResponse(
        { id: 'pref-1', init_point: 'https://x' },
        'sandbox',
      ),
    ).toBeNull();
    expect(
      mapPreferenceResponse(
        { id: 'pref-1', sandbox_init_point: 'https://y' },
        'production',
      ),
    ).toBeNull();
  });

  it.each([[null], [undefined], [{}]])(
    'tolerates a malformed body: %p',
    (body) => {
      expect(mapPreferenceResponse(body, 'sandbox')).toBeNull();
    },
  );
});
