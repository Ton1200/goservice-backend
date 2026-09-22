import { Logger } from '@nestjs/common';
import { CountryCode } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  ChargeSavedCardCommand,
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { RapydPaymentAdapter } from './rapyd-payment.adapter';

// Clearly synthetic — never a real credential.
const FAKE_ACCESS_KEY = 'rak_unit_test_access_key';
const FAKE_SECRET_KEY = 'rsk_unit_test_secret_key';

const CUSTOMER_ID = 'cus_b56b811068f7ca71dbf68e87a1411f29';
const CARD_ID = 'card_43084046ed2ecdf8b2dbc082e6e83ab3';
const PAYMENT_ID = 'payment_06145770edff02c9eb714d9d2f7c7245';

// Trimmed copy of a stored card observed LIVE in the GOS-146 sandbox run.
const STORED_CARD = {
  id: CARD_ID,
  type: 'ar_visa_f_card',
  category: 'card',
  name: 'GOS146 Vault',
  last4: '1111',
  bin_details: { type: 'DEBIT', brand: 'VISA', bin_number: '411111' },
  expiration_year: '30',
  expiration_month: '12',
  fingerprint_token: 'must-never-be-read',
};

const CHARGE: ChargeSavedCardCommand = {
  customerId: CUSTOMER_ID,
  providerCardId: CARD_ID,
  amount: 50000,
  currency: 'ARS',
  description: 'GoService — Engagement e-1',
  externalReference: 'e-1',
  idempotencyKey: 'attempt-1',
};

function payment(overrides: Record<string, unknown>) {
  return {
    status: { status: 'SUCCESS' },
    data: {
      id: PAYMENT_ID,
      amount: 50000,
      currency_code: 'ARS',
      merchant_reference_id: 'e-1',
      ...overrides,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('RapydPaymentAdapter — saved cards (GOS-146)', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  function makeAdapter(settings?: Record<string, string | null>) {
    const values: Record<string, string | null> = {
      'payments.payment-methods.rapyd.access-key': FAKE_ACCESS_KEY,
      'payments.payment-methods.rapyd.secret-key': FAKE_SECRET_KEY,
      'payments.payment-methods.rapyd.environment': 'sandbox',
      ...settings,
    };
    const platformSettingPort = {
      getValue: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
    } as unknown as PlatformSettingPort;
    return new RapydPaymentAdapter(platformSettingPort);
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

  describe('currentEnvironment', () => {
    it('returns the configured environment', async () => {
      await expect(makeAdapter().currentEnvironment()).resolves.toBe('sandbox');
    });

    it('fails closed when the credentials are not configured', async () => {
      await expect(
        makeAdapter({
          'payments.payment-methods.rapyd.access-key': null,
        }).currentEnvironment(),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
    });
  });

  describe('createCustomer', () => {
    it('POSTs only a name, an email and the profile id, and returns the customer id', async () => {
      respond(200, {
        status: { status: 'SUCCESS' },
        data: { id: CUSTOMER_ID },
      });

      const result = await makeAdapter().createCustomer({
        name: 'Ana Paz',
        email: 'ana@example.com',
        externalReference: 'profile-1',
      });

      expect(result).toEqual({ customerId: CUSTOMER_ID });
      const call = callAt(0);
      expect(call.url).toBe('https://sandboxapi.rapyd.net/v1/customers');
      expect(call.method).toBe('POST');
      expect(call.body).toEqual({
        name: 'Ana Paz',
        email: 'ana@example.com',
        metadata: { goserviceCustomerProfileId: 'profile-1' },
      });
      expect(call.headers.signature).toEqual(expect.any(String));
    });

    it('a 2xx without a usable customer id is an UNKNOWN outcome, never a rejection', async () => {
      respond(200, { status: { status: 'SUCCESS' }, data: {} });

      await expect(
        makeAdapter().createCustomer({
          name: 'Ana',
          email: 'a@example.com',
          externalReference: 'p',
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
        respond(status, { status: { error_code: 'X' } });

        await expect(
          makeAdapter().createCustomer({
            name: 'Ana',
            email: 'a@example.com',
            externalReference: 'p',
          }),
        ).rejects.toBeInstanceOf(errorClass);
      },
    );
  });

  describe('listSavedCards', () => {
    it('maps the vault to NON-sensitive facts (expiry "30" -> 2030) and drops what is not a card', async () => {
      respond(200, {
        status: { status: 'SUCCESS' },
        data: [
          STORED_CARD,
          { id: 'bank_123', category: 'bank_transfer' },
          {
            id: 'card_credit',
            category: 'card',
            last4: '4242',
            bin_details: { type: 'CREDIT', brand: 'MASTERCARD' },
            expiration_month: '1',
            expiration_year: '2031',
          },
        ],
      });

      const cards = await makeAdapter().listSavedCards(CUSTOMER_ID);

      expect(callAt(0).url).toBe(
        `https://sandboxapi.rapyd.net/v1/customers/${CUSTOMER_ID}/payment_methods`,
      );
      expect(cards).toEqual([
        {
          providerCardId: CARD_ID,
          brand: 'visa',
          lastFour: '1111',
          type: 'debit_card',
          expirationMonth: 12,
          expirationYear: 2030,
        },
        {
          providerCardId: 'card_credit',
          brand: 'mastercard',
          lastFour: '4242',
          type: 'credit_card',
          expirationMonth: 1,
          expirationYear: 2031,
        },
      ]);
      expect(JSON.stringify(cards)).not.toContain('must-never-be-read');
    });

    it('a customer Rapyd does not know has no cards', async () => {
      respond(404, { status: { error_code: 'ERROR_GET_CUSTOMER' } });

      await expect(makeAdapter().listSavedCards(CUSTOMER_ID)).resolves.toEqual(
        [],
      );
    });

    it('never calls Rapyd for a malformed customer id', async () => {
      await expect(makeAdapter().listSavedCards('../etc')).resolves.toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('chargeSavedCard', () => {
    it('charges the stored TOKEN server-side: customer + card id + installments 1, the attempt id as idempotency key — and no card data', async () => {
      respond(200, payment({ status: 'CLO', paid: true }));

      const result = await makeAdapter().chargeSavedCard(CHARGE);

      expect(result).toEqual({
        providerPaymentId: PAYMENT_ID,
        status: 'approved',
        externalReference: 'e-1',
        amount: 50000,
        currency: 'ARS',
      });
      const call = callAt(0);
      expect(call.url).toBe('https://sandboxapi.rapyd.net/v1/payments');
      expect(call.method).toBe('POST');
      expect(call.headers.idempotency).toBe('attempt-1');
      expect(call.body).toEqual({
        amount: 50000,
        currency: 'ARS',
        description: 'GoService — Engagement e-1',
        merchant_reference_id: 'e-1',
        customer: CUSTOMER_ID,
        payment_method: CARD_ID,
        payment_method_options: { installments: 1 },
      });
    });

    it('a declined card is NOT an exception: it resolves rejected with the domain reason', async () => {
      respond(
        200,
        payment({
          status: 'ERR',
          paid: false,
          failure_code: 'INSUFFICIENT_FUNDS',
        }),
      );

      const result = await makeAdapter().chargeSavedCard(CHARGE);

      expect(result).toMatchObject({
        status: 'rejected',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
    });

    it('when the issuer demands 3D Secure it resolves rejected AUTHENTICATION_REQUIRED and CANCELS the payment so it cannot be completed unseen', async () => {
      respond(
        200,
        payment({ status: 'ACT', paid: false, next_action: '3d_verification' }),
      );
      respond(200, { status: { status: 'SUCCESS' }, data: {} });

      const result = await makeAdapter().chargeSavedCard(CHARGE);

      expect(result).toMatchObject({
        status: 'rejected',
        rejectionReason: 'AUTHENTICATION_REQUIRED',
      });
      const cancel = callAt(1);
      expect(cancel.method).toBe('DELETE');
      expect(cancel.url).toBe(
        `https://sandboxapi.rapyd.net/v1/payments/${PAYMENT_ID}`,
      );
    });

    it('a failed cancel of the 3DS payment is logged but never turns the rejection into an error', async () => {
      respond(
        200,
        payment({ status: 'ACT', paid: false, next_action: '3d_verification' }),
      );
      respond(500, { status: { error_code: 'X' } });

      await expect(
        makeAdapter().chargeSavedCard(CHARGE),
      ).resolves.toMatchObject({ status: 'rejected' });
    });

    it('a not-yet-decided payment is pending', async () => {
      respond(200, payment({ status: 'ACT', paid: false }));

      await expect(
        makeAdapter().chargeSavedCard(CHARGE),
      ).resolves.toMatchObject({ status: 'pending' });
    });

    it('a 2xx without a payment is an UNKNOWN outcome (a charge may exist)', async () => {
      respond(200, { status: { status: 'SUCCESS' }, data: {} });

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
        respond(status, { status: { error_code: 'X' } });

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
    it('a failed server-side charge is TERMINAL (rejected) — unlike a payment inside a checkout', async () => {
      respond(
        200,
        payment({ status: 'ERR', paid: false, failure_code: 'DECLINED' }),
      );

      await expect(
        makeAdapter().readSavedCardCharge(PAYMENT_ID),
      ).resolves.toMatchObject({
        status: 'rejected',
        rejectionReason: 'CARD_DECLINED',
      });
    });

    it('a paid one is approved, and an unknown id is null', async () => {
      respond(200, payment({ status: 'CLO', paid: true }));
      respond(404, { status: { error_code: 'ERROR_GET_PAYMENT' } });

      const adapter = makeAdapter();
      await expect(
        adapter.readSavedCardCharge(PAYMENT_ID),
      ).resolves.toMatchObject({ status: 'approved' });
      await expect(adapter.readSavedCardCharge(PAYMENT_ID)).resolves.toBeNull();
    });
  });

  describe('deleteSavedCard', () => {
    it('DELETEs the card from the customer vault', async () => {
      respond(200, { status: { status: 'SUCCESS' }, data: {} });

      await makeAdapter().deleteSavedCard(CUSTOMER_ID, CARD_ID);

      const call = callAt(0);
      expect(call.method).toBe('DELETE');
      expect(call.url).toBe(
        `https://sandboxapi.rapyd.net/v1/customers/${CUSTOMER_ID}/payment_methods/${CARD_ID}`,
      );
    });

    it('is idempotent: a card Rapyd no longer knows is fine', async () => {
      respond(404, { status: { error_code: 'ERROR_GET_PAYMENT_METHOD' } });

      await expect(
        makeAdapter().deleteSavedCard(CUSTOMER_ID, CARD_ID),
      ).resolves.toBeUndefined();
    });

    it('a provider failure is surfaced (the local row must then be kept)', async () => {
      respond(503, { status: { error_code: 'X' } });

      await expect(
        makeAdapter().deleteSavedCard(CUSTOMER_ID, CARD_ID),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it('never calls Rapyd for malformed ids', async () => {
      await makeAdapter().deleteSavedCard('../x', CARD_ID);
      await makeAdapter().deleteSavedCard(CUSTOMER_ID, 'not-a-card');

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('createCheckout linked to a customer', () => {
    it('sends `customer` only when a customer id is given', async () => {
      const ok = {
        status: { status: 'SUCCESS' },
        data: { id: 'checkout_abc123', status: 'NEW' },
      };
      respond(200, ok);
      respond(200, ok);
      const command = {
        amount: 50000,
        currency: 'ARS',
        country: CountryCode.AR,
        description: 'd',
        externalReference: 'e-1',
        idempotencyKey: 'a-1',
      };

      const adapter = makeAdapter();
      await adapter.createCheckout({ ...command, customerId: CUSTOMER_ID });
      await adapter.createCheckout(command);

      expect(callAt(0).body).toMatchObject({ customer: CUSTOMER_ID });
      expect(callAt(1).body).not.toHaveProperty('customer');
    });
  });
});
