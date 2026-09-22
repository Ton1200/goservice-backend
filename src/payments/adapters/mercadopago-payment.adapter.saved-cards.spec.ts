import { Logger } from '@nestjs/common';
import { CountryCode } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  ChargeSavedCardCommand,
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { MercadoPagoPaymentAdapter } from './mercadopago-payment.adapter';

// Clearly synthetic — never a real credential.
const FAKE_ACCESS_TOKEN = 'APP_USR-unit-test-access-token';

const CUSTOMER_ID = 'cus_123456789';
const CARD_ID = 'card_987654321';
const ORDER_ID = 'ORD_SAVED_CARD_1';

const STORED_CARD_JSON = {
  id: CARD_ID,
  last_four_digits: '1111',
  expiration_month: 12,
  expiration_year: 2030,
  payment_method: { id: 'visa', payment_type_id: 'credit_card' },
};

const CHARGE: ChargeSavedCardCommand = {
  customerId: CUSTOMER_ID,
  providerCardId: CARD_ID,
  amount: 50000,
  currency: 'COP',
  description: 'GoService — Engagement e-1',
  externalReference: 'e-1',
  idempotencyKey: 'attempt-1',
  country: CountryCode.CO,
  providerToken: 'tok_re_tokenized_with_cvv',
  paymentMethodId: 'visa',
  payerEmail: 'buyer@example.com',
};

const APPROVED_ORDER_BODY = {
  id: ORDER_ID,
  status: 'processed',
  status_detail: 'accredited',
  external_reference: 'e-1',
  total_amount: '50000',
  currency: 'COP',
  transactions: {
    payments: [{ status: 'processed', status_detail: 'accredited' }],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MercadoPagoPaymentAdapter — saved cards (GOS-149)', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  function makeAdapter(settings?: Record<string, string | null>) {
    const values: Record<string, string | null> = {
      'payments.payment-methods.mercadopago.co.access-token': FAKE_ACCESS_TOKEN,
      'payments.payment-methods.mercadopago.co.environment': 'sandbox',
      ...settings,
    };
    const platformSettingPort = {
      getValue: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
    } as unknown as PlatformSettingPort;
    return new MercadoPagoPaymentAdapter(platformSettingPort);
  }

  function respond(status: number, body: unknown) {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(jsonResponse(status, body)),
    );
  }

  function callAt(index: number) {
    const [url, init] = fetchMock.mock.calls[index] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    return {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? (JSON.parse(init.body as string) as unknown) : null,
    };
  }

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
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

  describe('requireCountry — every method here functionally needs a country (credentials are per-country)', () => {
    it.each([
      [
        'currentEnvironment',
        (a: MercadoPagoPaymentAdapter) => a.currentEnvironment(),
      ],
      [
        'listSavedCards',
        (a: MercadoPagoPaymentAdapter) => a.listSavedCards(CUSTOMER_ID),
      ],
      [
        'deleteSavedCard',
        (a: MercadoPagoPaymentAdapter) =>
          a.deleteSavedCard(CUSTOMER_ID, CARD_ID),
      ],
      [
        'readSavedCardCharge',
        (a: MercadoPagoPaymentAdapter) => a.readSavedCardCharge(ORDER_ID),
      ],
    ])(
      '%s throws PAYMENT_PROVIDER_NOT_CONFIGURED with no country, never calling Mercado Pago',
      async (_name, call) => {
        const adapter = makeAdapter();

        await expect(call(adapter)).rejects.toBeInstanceOf(
          PaymentProviderNotConfiguredError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('currentEnvironment', () => {
    it("returns the given country's configured environment", async () => {
      await expect(
        makeAdapter().currentEnvironment(CountryCode.CO),
      ).resolves.toBe('sandbox');
    });

    it('fails closed when that country has no credentials', async () => {
      await expect(
        makeAdapter({
          'payments.payment-methods.mercadopago.co.access-token': null,
        }).currentEnvironment(CountryCode.CO),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
    });
  });

  describe('createCustomer', () => {
    it('POSTs an email, split first/last name and the profile id as description, and returns the customer id', async () => {
      respond(201, { id: CUSTOMER_ID });

      const result = await makeAdapter().createCustomer({
        name: 'Ana Paz',
        email: 'ana@example.com',
        externalReference: 'profile-1',
        country: CountryCode.CO,
      });

      expect(result).toEqual({ customerId: CUSTOMER_ID });
      const call = callAt(0);
      expect(call.url).toBe('https://api.mercadopago.com/v1/customers');
      expect(call.method).toBe('POST');
      expect(call.body).toEqual({
        email: 'ana@example.com',
        first_name: 'Ana',
        last_name: 'Paz',
        description: 'profile-1',
      });
      expect(call.headers.Authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
    });

    it('a 2xx without a usable customer id is an UNKNOWN outcome, never a rejection', async () => {
      respond(201, {});

      await expect(
        makeAdapter().createCustomer({
          name: 'Ana',
          email: 'a@example.com',
          externalReference: 'p',
          country: CountryCode.CO,
        }),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it.each([
      [401, PaymentProviderNotConfiguredError],
      [400, PaymentRequestRejectedError],
      [503, PaymentProviderUnavailableError],
    ])(
      'HTTP %i maps to the port error contract',
      async (status, errorClass) => {
        respond(status, { errors: [{ code: 'X' }] });

        await expect(
          makeAdapter().createCustomer({
            name: 'Ana',
            email: 'a@example.com',
            externalReference: 'p',
            country: CountryCode.CO,
          }),
        ).rejects.toBeInstanceOf(errorClass);
      },
    );
  });

  describe('listSavedCards', () => {
    it("maps the vault to NON-sensitive facts and drops what doesn't parse as a card", async () => {
      respond(200, [STORED_CARD_JSON, { last_four_digits: '0000' }]);

      const cards = await makeAdapter().listSavedCards(
        CUSTOMER_ID,
        CountryCode.CO,
      );

      expect(callAt(0).url).toBe(
        `https://api.mercadopago.com/v1/customers/${CUSTOMER_ID}/cards`,
      );
      expect(callAt(0).method).toBe('GET');
      expect(cards).toEqual([
        {
          providerCardId: CARD_ID,
          brand: 'visa',
          lastFour: '1111',
          type: 'credit_card',
          expirationMonth: 12,
          expirationYear: 2030,
        },
      ]);
    });

    it('a customer Mercado Pago does not know has no cards', async () => {
      respond(404, { message: 'not found' });

      await expect(
        makeAdapter().listSavedCards(CUSTOMER_ID, CountryCode.CO),
      ).resolves.toEqual([]);
    });

    it.each([
      [401, PaymentProviderNotConfiguredError],
      [503, PaymentProviderUnavailableError],
    ])(
      'HTTP %i maps to the port error contract',
      async (status, errorClass) => {
        respond(status, {});

        await expect(
          makeAdapter().listSavedCards(CUSTOMER_ID, CountryCode.CO),
        ).rejects.toBeInstanceOf(errorClass);
      },
    );
  });

  describe('associateCard (SaveCardOnChargeCapability — the ONLY way a card enters the vault)', () => {
    it('POSTs the just-used token and returns the resulting card', async () => {
      respond(201, STORED_CARD_JSON);

      const card = await makeAdapter().associateCard(
        CUSTOMER_ID,
        'tok_just_charged',
        CountryCode.CO,
      );

      expect(card).toEqual({
        providerCardId: CARD_ID,
        brand: 'visa',
        lastFour: '1111',
        type: 'credit_card',
        expirationMonth: 12,
        expirationYear: 2030,
      });
      const call = callAt(0);
      expect(call.url).toBe(
        `https://api.mercadopago.com/v1/customers/${CUSTOMER_ID}/cards`,
      );
      expect(call.method).toBe('POST');
      expect(call.body).toEqual({ token: 'tok_just_charged' });
    });

    it('a 2xx without a usable card is an UNKNOWN outcome', async () => {
      respond(201, {});

      await expect(
        makeAdapter().associateCard(
          CUSTOMER_ID,
          'tok_just_charged',
          CountryCode.CO,
        ),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it.each([
      [401, PaymentProviderNotConfiguredError],
      [400, PaymentRequestRejectedError],
      [503, PaymentProviderUnavailableError],
    ])(
      'HTTP %i maps to the port error contract',
      async (status, errorClass) => {
        respond(status, { errors: [{ code: 'X' }] });

        await expect(
          makeAdapter().associateCard(
            CUSTOMER_ID,
            'tok_just_charged',
            CountryCode.CO,
          ),
        ).rejects.toBeInstanceOf(errorClass);
      },
    );
  });

  describe('deleteSavedCard', () => {
    it('DELETEs the card from the customer vault', async () => {
      respond(200, {});

      await makeAdapter().deleteSavedCard(CUSTOMER_ID, CARD_ID, CountryCode.CO);

      const call = callAt(0);
      expect(call.method).toBe('DELETE');
      expect(call.url).toBe(
        `https://api.mercadopago.com/v1/customers/${CUSTOMER_ID}/cards/${CARD_ID}`,
      );
    });

    it('is idempotent: a card Mercado Pago no longer knows is fine', async () => {
      respond(404, { message: 'not found' });

      await expect(
        makeAdapter().deleteSavedCard(CUSTOMER_ID, CARD_ID, CountryCode.CO),
      ).resolves.toBeUndefined();
    });

    it('a provider failure is surfaced (the local row must then be kept)', async () => {
      respond(503, {});

      await expect(
        makeAdapter().deleteSavedCard(CUSTOMER_ID, CARD_ID, CountryCode.CO),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });
  });

  describe('chargeSavedCard', () => {
    it('charges via the SAME Orders API shape as chargeCard, with the re-tokenized providerToken and installments 1 — and the idempotency key', async () => {
      respond(201, APPROVED_ORDER_BODY);

      const result = await makeAdapter().chargeSavedCard(CHARGE);

      expect(result).toEqual({
        providerPaymentId: ORDER_ID,
        status: 'approved',
        externalReference: 'e-1',
        amount: 50000,
        currency: 'COP',
      });
      const call = callAt(0);
      expect(call.url).toBe('https://api.mercadopago.com/v1/orders');
      expect(call.method).toBe('POST');
      expect(call.headers['X-Idempotency-Key']).toBe('attempt-1');
      expect(call.body).toMatchObject({
        type: 'online',
        processing_mode: 'automatic',
        external_reference: 'e-1',
        payer: { email: 'buyer@example.com' },
        transactions: {
          payments: [
            {
              payment_method: {
                id: 'visa',
                type: 'credit_card',
                token: 'tok_re_tokenized_with_cvv',
                installments: 1,
              },
            },
          ],
        },
      });
    });

    it('rejects INVALID_CARD_DATA — no request sent — when providerToken is missing (no CVV, no charge)', async () => {
      await expect(
        makeAdapter().chargeSavedCard({ ...CHARGE, providerToken: undefined }),
      ).rejects.toMatchObject({ rejectionReason: 'INVALID_CARD_DATA' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects INVALID_CARD_DATA — no request sent — when paymentMethodId is missing', async () => {
      await expect(
        makeAdapter().chargeSavedCard({
          ...CHARGE,
          paymentMethodId: undefined,
        }),
      ).rejects.toMatchObject({ rejectionReason: 'INVALID_CARD_DATA' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a decline (HTTP 402) is NOT an exception: it resolves rejected with the order it carries', async () => {
      respond(402, {
        errors: [{ code: 'failed' }],
        data: {
          id: ORDER_ID,
          status: 'failed',
          status_detail: 'failed',
          external_reference: 'e-1',
          total_amount: '50000',
          currency: 'COP',
          transactions: {
            payments: [
              { status: 'failed', status_detail: 'insufficient_amount' },
            ],
          },
        },
      });

      const result = await makeAdapter().chargeSavedCard(CHARGE);

      expect(result).toMatchObject({ status: 'rejected' });
    });

    it('a 2xx without an order is an UNKNOWN outcome (a charge may exist)', async () => {
      respond(201, {});

      await expect(
        makeAdapter().chargeSavedCard(CHARGE),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it.each([
      [401, PaymentProviderNotConfiguredError],
      [400, PaymentRequestRejectedError],
      [500, PaymentProviderUnavailableError],
    ])(
      'HTTP %i maps to the port error contract',
      async (status, errorClass) => {
        respond(status, { errors: [{ code: 'X' }] });

        await expect(
          makeAdapter().chargeSavedCard(CHARGE),
        ).rejects.toBeInstanceOf(errorClass);
      },
    );

    it('a network failure is an unknown outcome', async () => {
      fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

      await expect(
        makeAdapter().chargeSavedCard(CHARGE),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });
  });

  describe('readSavedCardCharge', () => {
    it('is exactly getPayment — a saved-card charge is just another order', async () => {
      respond(200, APPROVED_ORDER_BODY);

      await expect(
        makeAdapter().readSavedCardCharge(ORDER_ID, CountryCode.CO),
      ).resolves.toMatchObject({ status: 'approved' });
      expect(callAt(0).url).toBe(
        `https://api.mercadopago.com/v1/orders/${ORDER_ID}`,
      );
    });

    it('an unknown order id is null', async () => {
      respond(404, {});

      await expect(
        makeAdapter().readSavedCardCharge(ORDER_ID, CountryCode.CO),
      ).resolves.toBeNull();
    });
  });
});
