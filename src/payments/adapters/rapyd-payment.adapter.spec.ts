import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { CountryCode, PaymentMethod } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  CreateCheckoutCommand,
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { RapydPaymentAdapter } from './rapyd-payment.adapter';

// Clearly synthetic — never a real credential.
const FAKE_ACCESS_KEY = 'rak_unit_test_access_key';
const FAKE_SECRET_KEY = 'rsk_unit_test_secret_key';

const COMMAND: CreateCheckoutCommand = {
  amount: 50000,
  currency: 'ARS',
  country: CountryCode.AR,
  description: 'GoService — Engagement e-1',
  externalReference: 'e-1',
  idempotencyKey: 'attempt-1',
};

const CHECKOUT_ID = 'checkout_447f948acde2a1dc0f85eb290e524f78';
const PAYMENT_ID = 'payment_06145770edff02c9eb714d9d2f7c7245';

// Trimmed copies of the shapes the GOS-75 PoC saved/observed live.
const CREATE_OK = {
  status: { status: 'SUCCESS', error_code: '' },
  data: {
    id: CHECKOUT_ID,
    status: 'NEW',
    amount: 50000,
    currency: 'ARS',
    payment: { id: null, status: null, paid: false },
  },
};
const CHECKOUT_PAID = {
  status: { status: 'SUCCESS' },
  data: {
    id: CHECKOUT_ID,
    status: 'DON',
    amount: 50000,
    currency: 'ARS',
    merchant_reference_id: 'e-1',
    payment: {
      id: PAYMENT_ID,
      status: 'CLO',
      paid: true,
      amount: 50000,
      currency_code: 'ARS',
      merchant_reference_id: 'e-1',
    },
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('RapydPaymentAdapter', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  function makeAdapter(settings?: Record<string, string | null>) {
    const values: Record<string, string | null> = {
      'payments.payment-methods.rapyd.access-key': FAKE_ACCESS_KEY,
      'payments.payment-methods.rapyd.secret-key': FAKE_SECRET_KEY,
      'payments.payment-methods.rapyd.environment': 'sandbox',
      ...settings,
    };
    const getValue = jest.fn((key: string) =>
      Promise.resolve(values[key] ?? null),
    );
    const platformSettingPort = { getValue } as unknown as PlatformSettingPort;
    return { adapter: new RapydPaymentAdapter(platformSettingPort), getValue };
  }

  function lastCall() {
    const [url, init] = fetchMock.mock.calls[
      fetchMock.mock.calls.length - 1
    ] as [string, RequestInit & { headers: Record<string, string> }];
    return { url, init, headers: init.headers };
  }

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });
  afterAll(() => jest.restoreAllMocks());

  it('is the RAPYD provider: embedded checkout + saved cards, and NOT the Mercado Pago flows', () => {
    const { adapter } = makeAdapter();

    expect(adapter.method).toBe(PaymentMethod.RAPYD);
    expect([...adapter.capabilities]).toEqual([
      'EMBEDDED_CHECKOUT',
      'SAVED_CARDS',
    ]);
  });

  describe('createCheckout', () => {
    it('POSTs /v1/checkout with server-derived values, the Engagement id as merchant reference, the attempt id as idempotency key — and NEVER a method restriction or fake redirect URLs', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(200, CREATE_OK));

      const result = await adapter.createCheckout(COMMAND);

      expect(result).toEqual({
        checkoutId: CHECKOUT_ID,
        toolkitScriptUrl: 'https://sandboxcheckouttoolkit.rapyd.net',
      });
      const { url, init, headers } = lastCall();
      expect(url).toBe('https://sandboxapi.rapyd.net/v1/checkout');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        amount: 50000,
        currency: 'ARS',
        country: 'AR',
        merchant_reference_id: 'e-1',
      });
      expect(body).not.toHaveProperty('payment_method_types_include');
      // The widget is restricted to the card CATEGORY (verified live in Colombia:
      // without it the Toolkit opens on bank/Addi and paying fails).
      expect(body).toMatchObject({ payment_method_type_categories: ['card'] });
      expect(body).not.toHaveProperty('complete_checkout_url');
      expect(body).not.toHaveProperty('error_checkout_url');
      expect(body).not.toHaveProperty('escrow');
      expect(headers['idempotency']).toBe('attempt-1');
      expect(headers['access_key']).toBe(FAKE_ACCESS_KEY);
    });

    it('signs the request exactly per the documented request-signature formula, over the exact body sent', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(200, CREATE_OK));

      await adapter.createCheckout(COMMAND);

      const { init, headers } = lastCall();
      const toSign =
        'post/v1/checkout' +
        headers['salt'] +
        headers['timestamp'] +
        FAKE_ACCESS_KEY +
        FAKE_SECRET_KEY +
        (init.body as string);
      const hex = createHmac('sha256', FAKE_SECRET_KEY)
        .update(toSign)
        .digest('hex');
      expect(headers['signature']).toBe(Buffer.from(hex).toString('base64'));
      // The secret itself is never sent.
      expect(JSON.stringify(headers)).not.toContain(FAKE_SECRET_KEY);
    });

    it('uses the production hosts for a country configured as production', async () => {
      const { adapter } = makeAdapter({
        'payments.payment-methods.rapyd.environment': 'production',
      });
      fetchMock.mockResolvedValue(jsonResponse(200, CREATE_OK));

      const result = await adapter.createCheckout(COMMAND);

      expect(lastCall().url).toBe('https://api.rapyd.net/v1/checkout');
      expect(result.toolkitScriptUrl).toBe('https://checkouttoolkit.rapyd.net');
    });

    it('sends a checkout expiration from the admin setting, and omits it when the setting is missing or invalid', async () => {
      const withSetting = makeAdapter({
        'payments.payment-methods.rapyd.checkout-expiration-minutes': '60',
      });
      fetchMock.mockResolvedValue(jsonResponse(200, CREATE_OK));
      const now = Math.floor(Date.now() / 1000);
      await withSetting.adapter.createCheckout(COMMAND);
      const sent = JSON.parse(lastCall().init.body as string) as {
        page_expiration?: number;
        expiration?: number;
      };
      expect(sent.page_expiration).toBeGreaterThanOrEqual(now + 3600);
      expect(sent.page_expiration).toBeLessThanOrEqual(now + 3600 + 5);
      // Rapyd IGNORES the docs' `expiration` field (verified live) — never sent.
      expect(sent).not.toHaveProperty('expiration');

      for (const bad of [null, 'soon', '0', '-5', '999999']) {
        const { adapter } = makeAdapter({
          'payments.payment-methods.rapyd.checkout-expiration-minutes': bad,
        });
        fetchMock.mockResolvedValue(jsonResponse(200, CREATE_OK));
        await adapter.createCheckout(COMMAND);
        expect(JSON.parse(lastCall().init.body as string)).not.toHaveProperty(
          'page_expiration',
        );
      }
    });

    it.each([
      ['access key', { 'payments.payment-methods.rapyd.access-key': null }],
      ['secret key', { 'payments.payment-methods.rapyd.secret-key': '   ' }],
      ['environment', { 'payments.payment-methods.rapyd.environment': null }],
      [
        'a bogus environment',
        { 'payments.payment-methods.rapyd.environment': 'staging' },
      ],
    ])(
      'fails closed with PaymentProviderNotConfiguredError, sending NOTHING, when the %s is missing/invalid',
      async (_label, settings) => {
        const { adapter } = makeAdapter(settings);

        await expect(adapter.createCheckout(COMMAND)).rejects.toBeInstanceOf(
          PaymentProviderNotConfiguredError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('uses ONE credential set for EVERY country (verified live: the same keys completed a COP and an ARS payment) — the country only travels as a field of the checkout', async () => {
      const { adapter, getValue } = makeAdapter();
      // A fresh Response per call (a Response body can only be read once).
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(200, CREATE_OK)),
      );

      await adapter.createCheckout({ ...COMMAND, country: CountryCode.AR });
      await adapter.createCheckout({
        ...COMMAND,
        country: CountryCode.CO,
        currency: 'COP',
      });

      const [first, second] = fetchMock.mock.calls.map(
        ([, init]) =>
          JSON.parse((init as RequestInit).body as string) as Record<
            string,
            unknown
          >,
      );
      expect(first).toMatchObject({ country: 'AR', currency: 'ARS' });
      expect(second).toMatchObject({ country: 'CO', currency: 'COP' });
      // Same keys both times, and NO per-country setting is ever consulted.
      const keysRead = getValue.mock.calls.map(([key]) => key);
      expect(new Set(keysRead)).toEqual(
        new Set([
          'payments.payment-methods.rapyd.access-key',
          'payments.payment-methods.rapyd.secret-key',
          'payments.payment-methods.rapyd.environment',
          'payments.payment-methods.rapyd.checkout-expiration-minutes',
        ]),
      );
      expect(
        fetchMock.mock.calls.every(
          ([, init]) =>
            (init as RequestInit & { headers: Record<string, string> }).headers[
              'access_key'
            ] === FAKE_ACCESS_KEY,
        ),
      ).toBe(true);
    });

    it.each([[401], [403]])(
      'HTTP %s (bad key / bad signature) -> PaymentProviderNotConfiguredError',
      async (status) => {
        const { adapter } = makeAdapter();
        fetchMock.mockResolvedValue(
          jsonResponse(status, {
            status: { error_code: 'UNAUTHORIZED_API_CALL' },
          }),
        );

        await expect(adapter.createCheckout(COMMAND)).rejects.toBeInstanceOf(
          PaymentProviderNotConfiguredError,
        );
      },
    );

    it.each([[408], [409], [429], [500], [503]])(
      'HTTP %s -> PaymentProviderUnavailableError (outcome unknown)',
      async (status) => {
        const { adapter } = makeAdapter();
        fetchMock.mockResolvedValue(jsonResponse(status, {}));

        await expect(adapter.createCheckout(COMMAND)).rejects.toBeInstanceOf(
          PaymentProviderUnavailableError,
        );
      },
    );

    it('a timeout / network error -> PaymentProviderUnavailableError (never assumed rejected)', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockRejectedValue(new DOMException('aborted', 'TimeoutError'));

      await expect(adapter.createCheckout(COMMAND)).rejects.toBeInstanceOf(
        PaymentProviderUnavailableError,
      );
    });

    it('a 2xx without a usable checkout id -> PaymentProviderUnavailableError (one may exist)', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(200, { status: {}, data: {} }));

      await expect(adapter.createCheckout(COMMAND)).rejects.toBeInstanceOf(
        PaymentProviderUnavailableError,
      );
    });

    it.each([
      [400, 'PROVIDER_ERROR'],
      [422, 'OTHER'],
    ])(
      'HTTP %s (definitive refusal, no checkout created) -> PaymentRequestRejectedError(%s)',
      async (status, reason) => {
        const { adapter } = makeAdapter();
        fetchMock.mockResolvedValue(
          jsonResponse(status, { status: { error_code: 'ERROR_X' } }),
        );

        await expect(adapter.createCheckout(COMMAND)).rejects.toEqual(
          new PaymentRequestRejectedError(reason as 'OTHER'),
        );
      },
    );

    it('never logs the access or secret key', async () => {
      const logs: unknown[] = [];
      for (const level of ['log', 'warn', 'error'] as const) {
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((message: unknown) => {
            logs.push(message);
          });
      }
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(401, {}));

      await adapter.createCheckout(COMMAND).catch(() => undefined);

      expect(JSON.stringify(logs)).not.toContain(FAKE_SECRET_KEY);
      expect(JSON.stringify(logs)).not.toContain(FAKE_ACCESS_KEY);
    });
  });

  describe('getCheckoutSnapshot', () => {
    it('GETs /v1/checkout/{id} with an empty signed body and normalizes a PAID checkout to approved', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(200, CHECKOUT_PAID));

      const snapshot = await adapter.getCheckoutSnapshot(CHECKOUT_ID);

      expect(snapshot).toMatchObject({
        checkoutId: CHECKOUT_ID,
        status: 'approved',
        providerPaymentId: PAYMENT_ID,
        amount: 50000,
        currency: 'ARS',
        externalReference: 'e-1',
      });
      const { url, init, headers } = lastCall();
      expect(url).toBe(
        `https://sandboxapi.rapyd.net/v1/checkout/${CHECKOUT_ID}`,
      );
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      const toSign =
        `get/v1/checkout/${CHECKOUT_ID}` +
        headers['salt'] +
        headers['timestamp'] +
        FAKE_ACCESS_KEY +
        FAKE_SECRET_KEY; // empty body, never "{}"
      const hex = createHmac('sha256', FAKE_SECRET_KEY)
        .update(toSign)
        .digest('hex');
      expect(headers['signature']).toBe(Buffer.from(hex).toString('base64'));
    });

    it('normalizes a fresh checkout to pending / open / no payment', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(200, CREATE_OK));

      await expect(
        adapter.getCheckoutSnapshot(CHECKOUT_ID),
      ).resolves.toMatchObject({
        status: 'pending',
        open: true,
        paymentCreated: false,
        providerPaymentId: null,
      });
    });

    it('resolves null WITHOUT calling Rapyd for a malformed id (it would be interpolated into a URL)', async () => {
      const { adapter } = makeAdapter();

      await expect(
        adapter.getCheckoutSnapshot('../v1/payments'),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('404 -> null (Rapyd does not know it)', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(404, {}));

      await expect(
        adapter.getCheckoutSnapshot(CHECKOUT_ID),
      ).resolves.toBeNull();
    });

    it('a 2xx carrying no usable checkout is a provider FAULT (Unavailable), not "unknown"', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(200, { status: {}, data: {} }));

      await expect(
        adapter.getCheckoutSnapshot(CHECKOUT_ID),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it('5xx -> Unavailable so a webhook is answered 5xx and Rapyd retries; 401 -> NotConfigured', async () => {
      const { adapter } = makeAdapter();

      fetchMock.mockResolvedValue(jsonResponse(502, {}));
      await expect(
        adapter.getCheckoutSnapshot(CHECKOUT_ID),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);

      fetchMock.mockResolvedValue(jsonResponse(401, {}));
      await expect(
        adapter.getCheckoutSnapshot(CHECKOUT_ID),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
    });

    it('a permanent 4xx refusal of a lookup becomes null (not an endless webhook retry) — logged for an operator', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(
        jsonResponse(400, { status: { error_code: 'ERROR_GET' } }),
      );

      await expect(
        adapter.getCheckoutSnapshot(CHECKOUT_ID),
      ).resolves.toBeNull();
    });
  });

  describe('readPayment', () => {
    it('GETs /v1/payments/{id} and normalizes a CLO/paid payment to approved', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          status: {},
          data: CHECKOUT_PAID.data.payment,
        }),
      );

      await expect(adapter.readPayment(PAYMENT_ID)).resolves.toMatchObject({
        providerPaymentId: PAYMENT_ID,
        status: 'approved',
        amount: 50000,
        currency: 'ARS',
        externalReference: 'e-1',
      });
      expect(lastCall().url).toBe(
        `https://sandboxapi.rapyd.net/v1/payments/${PAYMENT_ID}`,
      );
    });

    it('rounds a decimal ARS amount to whole units', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          status: {},
          data: { ...CHECKOUT_PAID.data.payment, amount: 50000.4 },
        }),
      );

      const snapshot = await adapter.readPayment(PAYMENT_ID);

      expect(snapshot?.amount).toBe(50000);
    });

    it('resolves null WITHOUT calling Rapyd for something that is not a payment_ id', async () => {
      const { adapter } = makeAdapter();

      await expect(adapter.readPayment(CHECKOUT_ID)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('getTransactionDetails (best effort)', () => {
    const PAID_WITH_CARD = {
      status: {},
      data: {
        ...CHECKOUT_PAID.data.payment,
        payment_method_data: {
          last4: '1111',
          bin_details: { brand: 'VISA', type: 'CREDIT' },
        },
      },
    };

    it('reads the brand and last four of the payment, with a short timeout', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(200, PAID_WITH_CARD));

      const details = await adapter.getTransactionDetails(PAYMENT_ID, 'e-1');

      expect(details).toMatchObject({
        paymentTypeId: 'credit_card',
        cardBrand: 'visa',
        cardLastFour: '1111',
      });
    });

    it('never attributes a payment that echoes a DIFFERENT merchant reference', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(jsonResponse(200, PAID_WITH_CARD));

      await expect(
        adapter.getTransactionDetails(PAYMENT_ID, 'other-engagement'),
      ).resolves.toBeNull();
    });

    it('404 -> null; a failure propagates as an error the CALLER swallows', async () => {
      const { adapter } = makeAdapter();

      fetchMock.mockResolvedValue(jsonResponse(404, {}));
      await expect(
        adapter.getTransactionDetails(PAYMENT_ID, 'e-1'),
      ).resolves.toBeNull();

      fetchMock.mockResolvedValue(jsonResponse(500, {}));
      await expect(
        adapter.getTransactionDetails(PAYMENT_ID, 'e-1'),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it('a field Rapyd does not report is simply null — the payment is unaffected', async () => {
      const { adapter } = makeAdapter();
      fetchMock.mockResolvedValue(
        jsonResponse(200, { status: {}, data: CHECKOUT_PAID.data.payment }),
      );

      await expect(
        adapter.getTransactionDetails(PAYMENT_ID, 'e-1'),
      ).resolves.toMatchObject({
        paymentTypeId: null,
        cardBrand: null,
        cardLastFour: null,
      });
    });
  });

  describe('isConfigured / getToolkitScriptUrl', () => {
    it('isConfigured is true only with both keys AND a valid environment — and never throws for "not configured"', async () => {
      await expect(makeAdapter().adapter.isConfigured()).resolves.toBe(true);
      for (const missing of [
        'payments.payment-methods.rapyd.access-key',
        'payments.payment-methods.rapyd.secret-key',
        'payments.payment-methods.rapyd.environment',
      ]) {
        await expect(
          makeAdapter({ [missing]: null }).adapter.isConfigured(),
        ).resolves.toBe(false);
      }
    });

    it('getToolkitScriptUrl follows the configured environment', async () => {
      const { adapter } = makeAdapter({
        'payments.payment-methods.rapyd.environment': 'production',
      });

      await expect(adapter.getToolkitScriptUrl()).resolves.toBe(
        'https://checkouttoolkit.rapyd.net',
      );
    });
  });
});
