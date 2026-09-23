import { Logger } from '@nestjs/common';
import { CountryCode } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  ChargeCardCommand,
  CreateWalletPreferenceCommand,
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { MercadoPagoPaymentAdapter } from './mercadopago-payment.adapter';

// GOS-142 — global (not per-country) wallet checkout config keys, see
// `mercadoPagoWalletCheckoutSettingKeys`'s own comment.
const WALLET_CHECKOUT_SETTINGS = {
  'payments.general-settings.callbacks.public-base-url':
    'https://api.goservice.example',
  'payments.payment-methods.mercadopago.wallet.back-url-success':
    'https://app.goservice.example/payments/success',
  'payments.payment-methods.mercadopago.wallet.back-url-pending':
    'https://app.goservice.example/payments/pending',
  'payments.payment-methods.mercadopago.wallet.back-url-failure':
    'https://app.goservice.example/payments/failure',
};

const WALLET_COMMAND: CreateWalletPreferenceCommand = {
  amount: 50000,
  currency: 'COP',
  country: CountryCode.CO,
  description: 'Engagement payment',
  externalReference: 'engagement-1',
  payerEmail: 'buyer@example.com',
};

// Clearly synthetic — never a real credential.
const FAKE_ACCESS_TOKEN = 'APP_USR-unit-test-access-token';

const COMMAND: ChargeCardCommand = {
  cardToken: 'tok_unit_test',
  amount: 50000,
  currency: 'COP',
  country: CountryCode.CO,
  description: 'Engagement payment',
  externalReference: 'engagement-1',
  paymentMethodId: 'visa',
  installments: 1,
  payerEmail: 'buyer@example.com',
  idempotencyKey: 'attempt-1',
};

// Trimmed copies of the live sandbox responses (see the mapper spec).
const APPROVED_BODY = {
  id: 'ORD_APPROVED',
  status: 'processed',
  status_detail: 'accredited',
  external_reference: 'engagement-1',
  total_amount: '50000',
  currency: 'COP',
  transactions: {
    payments: [{ status: 'processed', status_detail: 'accredited' }],
  },
};
const DECLINED_402_BODY = {
  errors: [
    {
      code: 'failed',
      message: 'The following transactions failed',
      details: ['PAY1: insufficient_amount'],
    },
  ],
  data: {
    id: 'ORD_DECLINED',
    status: 'failed',
    status_detail: 'failed',
    external_reference: 'engagement-1',
    total_amount: '50000',
    currency: 'COP',
    transactions: {
      payments: [{ status: 'failed', status_detail: 'insufficient_amount' }],
    },
  },
};
const PENDING_BODY = {
  id: 'ORD_PENDING',
  status: 'processing',
  status_detail: 'in_process',
  external_reference: 'engagement-1',
  total_amount: '50000',
  currency: 'COP',
  transactions: {
    payments: [{ status: 'processing', status_detail: 'in_process' }],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MercadoPagoPaymentAdapter', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  function makeAdapter(settings?: Record<string, string | null>) {
    const values: Record<string, string | null> = {
      'payments.payment-methods.mercadopago.co.access-token': FAKE_ACCESS_TOKEN,
      'payments.payment-methods.mercadopago.co.environment': 'sandbox',
      ...settings,
    };
    const getValue = jest.fn((key: string) =>
      Promise.resolve(values[key] ?? null),
    );
    const adapter = new MercadoPagoPaymentAdapter({
      getValue,
    } as unknown as PlatformSettingPort);
    return { adapter, getValue };
  }

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  describe('chargeCard', () => {
    it('POSTs an automatic-mode order with no split and no capture_mode, idempotency key + bearer token', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, APPROVED_BODY)),
      );
      const { adapter } = makeAdapter();

      await adapter.chargeCard(COMMAND);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.mercadopago.com/v1/orders');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${FAKE_ACCESS_TOKEN}`,
        'X-Idempotency-Key': 'attempt-1',
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).toEqual({
        type: 'online',
        processing_mode: 'automatic',
        external_reference: 'engagement-1',
        description: 'Engagement payment',
        total_amount: '50000',
        // `makeAdapter()`'s default environment is 'sandbox' — see the
        // dedicated 'payer.email' describe block below for why this is
        // 'test@testuser.com', never the real Customer email, in sandbox.
        payer: { email: 'test@testuser.com' },
        transactions: {
          payments: [
            {
              amount: '50000',
              payment_method: {
                id: 'visa',
                type: 'credit_card',
                token: 'tok_unit_test',
                installments: 1,
              },
            },
          ],
        },
      });
      // DEC-009 / GOS-75 findings #3 and #4: no provider hold, no split.
      expect(JSON.stringify(body)).not.toMatch(
        /capture_mode|marketplace_fee|application_fee/,
      );
    });

    it('formats an ARS amount with two decimals', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(201, {
            ...APPROVED_BODY,
            currency: 'ARS',
            total_amount: '200.00',
          }),
        ),
      );
      const { adapter } = makeAdapter();

      await adapter.chargeCard({ ...COMMAND, amount: 200, currency: 'ARS' });

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as { total_amount: string };
      expect(body.total_amount).toBe('200.00');
    });

    // GOS-86 runtime QA finding (2026-09-23): Mercado Pago's Orders API
    // sandbox accepts, per its own integration-test docs, ONLY
    // 'test@testuser.com' as `payer.email` — the real Customer's email gets
    // the whole order refused with a 400. Verified live: every Argentina
    // sandbox attempt sending the real email came back REJECTED /
    // PROVIDER_ERROR.
    describe('payer.email (sandbox vs. production, GOS-86)', () => {
      async function bodyOf(
        command = COMMAND,
        settings?: Record<string, string | null>,
      ) {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(201, APPROVED_BODY)),
        );
        const { adapter } = makeAdapter(settings);
        await adapter.chargeCard(command);
        const lastCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
        return JSON.parse(lastCall[1].body as string) as {
          payer: { email: string };
        };
      }

      it('sandbox: always sends test@testuser.com, regardless of the real Customer email', async () => {
        const body = await bodyOf({
          ...COMMAND,
          payerEmail: 'maria.customer1@goservice.dev',
        });
        expect(body.payer).toEqual({ email: 'test@testuser.com' });
      });

      it('production: sends the real Customer email exactly as before this fix', async () => {
        const body = await bodyOf(
          { ...COMMAND, payerEmail: 'maria.customer1@goservice.dev' },
          {
            'payments.payment-methods.mercadopago.co.environment': 'production',
          },
        );
        expect(body.payer).toEqual({
          email: 'maria.customer1@goservice.dev',
        });
      });

      it('sandbox vs. production differ ONLY in payer.email — every other order field is identical', async () => {
        const sandboxBody = await bodyOf();
        const productionBody = await bodyOf(COMMAND, {
          'payments.payment-methods.mercadopago.co.environment': 'production',
        });
        expect({ ...sandboxBody, payer: undefined }).toEqual({
          ...productionBody,
          payer: undefined,
        });
        expect(sandboxBody.payer).not.toEqual(productionBody.payer);
      });
    });

    it('sends the requested installments', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, APPROVED_BODY)),
      );
      const { adapter } = makeAdapter();

      await adapter.chargeCard({ ...COMMAND, installments: 6 });

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as {
        transactions: {
          payments: { payment_method: { installments: number } }[];
        };
      };
      expect(body.transactions.payments[0].payment_method.installments).toBe(6);
    });

    describe('debit cards (live-verified shape, Colombia sandbox)', () => {
      const paymentMethodOf = (call: unknown[]) =>
        (
          JSON.parse((call[1] as RequestInit).body as string) as {
            transactions: { payments: { payment_method: object }[] };
          }
        ).transactions.payments[0].payment_method;

      it.each([['debvisa'], ['debmaster']])(
        'sends %s as a debit_card with NO installments field',
        async (paymentMethodId) => {
          fetchMock.mockImplementation(() =>
            Promise.resolve(jsonResponse(201, APPROVED_BODY)),
          );
          const { adapter } = makeAdapter();

          await expect(
            adapter.chargeCard({ ...COMMAND, paymentMethodId }),
          ).resolves.toEqual({
            providerPaymentId: 'ORD_APPROVED',
            status: 'approved',
          });

          const paymentMethod = paymentMethodOf(
            fetchMock.mock.calls[0] as unknown[],
          );
          expect(paymentMethod).toEqual({
            id: paymentMethodId,
            type: 'debit_card',
            token: 'tok_unit_test',
          });
          expect(paymentMethod).not.toHaveProperty('installments');
        },
      );

      it('still sends a credit brand as credit_card WITH its installments', async () => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(201, APPROVED_BODY)),
        );
        const { adapter } = makeAdapter();

        await adapter.chargeCard({
          ...COMMAND,
          paymentMethodId: 'master',
          installments: 3,
        });

        expect(paymentMethodOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
          id: 'master',
          type: 'credit_card',
          token: 'tok_unit_test',
          installments: 3,
        });
      });

      it.each([[2], [6], [12]])(
        'refuses a debit card with %i installments BEFORE any request — a definitive "no charge", not a silent downgrade to 1',
        async (installments) => {
          const { adapter, getValue } = makeAdapter();

          await expect(
            adapter.chargeCard({
              ...COMMAND,
              paymentMethodId: 'debvisa',
              installments,
            }),
          ).rejects.toMatchObject({
            name: 'PaymentRequestRejectedError',
            rejectionReason: 'INVALID_CARD_DATA',
          });
          expect(fetchMock).not.toHaveBeenCalled();
          expect(getValue).not.toHaveBeenCalled(); // not even the credentials
        },
      );
    });

    it('maps an approved 201 to approved, with the ORDER id as providerPaymentId', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, APPROVED_BODY)),
      );
      const { adapter } = makeAdapter();

      await expect(adapter.chargeCard(COMMAND)).resolves.toEqual({
        providerPaymentId: 'ORD_APPROVED',
        status: 'approved',
      });
    });

    it('maps a pending 201 (processing / in_process) to pending', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, PENDING_BODY)),
      );
      const { adapter } = makeAdapter();

      await expect(adapter.chargeCard(COMMAND)).resolves.toEqual({
        providerPaymentId: 'ORD_PENDING',
        status: 'pending',
      });
    });

    it('treats the 402 decline as a RESULT (not an error), reading order + reason from `data`', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(402, DECLINED_402_BODY)),
      );
      const { adapter } = makeAdapter();

      await expect(adapter.chargeCard(COMMAND)).resolves.toEqual({
        providerPaymentId: 'ORD_DECLINED',
        status: 'rejected',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
    });

    it('never leaks the processor status_detail — only the bucketed reason', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(402, DECLINED_402_BODY)),
      );
      const { adapter } = makeAdapter();

      const result = await adapter.chargeCard(COMMAND);

      expect(JSON.stringify(result)).not.toContain('insufficient_amount');
    });

    it('rejects a 402 with no order body as a definitive request rejection', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(402, { errors: [{ code: 'failed' }] })),
      );
      const { adapter } = makeAdapter();

      await expect(adapter.chargeCard(COMMAND)).rejects.toBeInstanceOf(
        PaymentRequestRejectedError,
      );
    });

    it.each([
      [422, 'INVALID_CARD_DATA'],
      [400, 'PROVIDER_ERROR'],
      [404, 'OTHER'],
    ])(
      'maps a %i refusal to PaymentRequestRejectedError(%s) — a definitive "no charge"',
      async (status, reason) => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(status, { errors: [{ code: 'x' }] })),
        );
        const { adapter } = makeAdapter();

        await expect(adapter.chargeCard(COMMAND)).rejects.toMatchObject({
          name: 'PaymentRequestRejectedError',
          rejectionReason: reason,
        });
      },
    );

    it.each([[401], [403]])(
      'maps HTTP %i to PaymentProviderNotConfiguredError',
      async (status) => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(status, { message: 'Unauthorized' })),
        );
        const { adapter } = makeAdapter();

        await expect(adapter.chargeCard(COMMAND)).rejects.toBeInstanceOf(
          PaymentProviderNotConfiguredError,
        );
      },
    );

    it.each([[500], [502], [503], [429], [408], [409]])(
      'maps HTTP %i to PaymentProviderUnavailableError — outcome unknown, never "rejected"',
      async (status) => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(status, {})),
        );
        const { adapter } = makeAdapter();

        await expect(adapter.chargeCard(COMMAND)).rejects.toBeInstanceOf(
          PaymentProviderUnavailableError,
        );
      },
    );

    it('maps a network failure to PaymentProviderUnavailableError without echoing the error text', async () => {
      fetchMock.mockRejectedValue(
        new Error('connect ECONNRESET with secret details'),
      );
      const { adapter } = makeAdapter();

      const promise = adapter.chargeCard(COMMAND);

      await expect(promise).rejects.toBeInstanceOf(
        PaymentProviderUnavailableError,
      );
      await expect(promise).rejects.not.toThrow(/secret details/);
    });

    it('treats a 2xx without an order id as unknown outcome, not as rejected', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, { status: 'processed' })),
      );
      const { adapter } = makeAdapter();

      await expect(adapter.chargeCard(COMMAND)).rejects.toBeInstanceOf(
        PaymentProviderUnavailableError,
      );
    });

    it('tolerates a non-JSON error body (e.g. an edge HTML page)', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response('<html>oops</html>', { status: 502 })),
      );
      const { adapter } = makeAdapter();

      await expect(adapter.chargeCard(COMMAND)).rejects.toBeInstanceOf(
        PaymentProviderUnavailableError,
      );
    });

    it.each([
      [
        'access token missing',
        { 'payments.payment-methods.mercadopago.co.access-token': null },
      ],
      [
        'access token blank',
        { 'payments.payment-methods.mercadopago.co.access-token': '   ' },
      ],
      [
        'environment missing',
        { 'payments.payment-methods.mercadopago.co.environment': null },
      ],
      [
        'environment invalid',
        { 'payments.payment-methods.mercadopago.co.environment': 'staging' },
      ],
    ])(
      'fails closed BEFORE any HTTP call when configuration is bad: %s',
      async (_label, settings) => {
        const { adapter } = makeAdapter(settings);

        await expect(adapter.chargeCard(COMMAND)).rejects.toBeInstanceOf(
          PaymentProviderNotConfiguredError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('reads the credentials fresh on every call (never cached)', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, APPROVED_BODY)),
      );
      const { adapter, getValue } = makeAdapter();

      await adapter.chargeCard(COMMAND);
      await adapter.chargeCard(COMMAND);

      const tokenReads = getValue.mock.calls.filter(
        ([key]) =>
          key === 'payments.payment-methods.mercadopago.co.access-token',
      );
      expect(tokenReads).toHaveLength(2);
    });
  });

  describe('getTransactionDetails (best-effort read of the payment record)', () => {
    // Trimmed copy of a REAL sandbox payment record (Colombia, visa credit,
    // 50.000 COP). Personal fields are deliberately absent.
    const PAYMENT_RECORD = {
      payment_type_id: 'credit_card',
      payment_method_id: 'visa',
      card: { last_four_digits: '6260' },
      charges_details: [
        {
          type: 'fee',
          accounts: { from: 'collector' },
          amounts: { original: 2912 },
        },
        {
          type: 'tax',
          accounts: { from: 'collector' },
          amounts: { original: 957 },
        },
      ],
      transaction_details: { net_received_amount: 46131 },
      date_approved: '2026-09-18T11:05:28.000-04:00',
      money_release_date: '2026-09-18T11:05:28.000-04:00',
      point_of_interaction: { references: [{ id: 'ORD_APPROVED' }] },
    };
    const searchBody = (...results: object[]) => ({
      results,
      paging: { total: results.length },
    });

    it('searches the payment by the external reference, approved only, and maps the record linked to THIS order', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(200, searchBody(PAYMENT_RECORD))),
      );
      const { adapter } = makeAdapter();

      const details = await adapter.getTransactionDetails(
        'ORD_APPROVED',
        'engagement-1',
        CountryCode.CO,
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://api.mercadopago.com/v1/payments/search?external_reference=engagement-1&status=approved&sort=date_approved&criteria=desc',
      );
      expect(init.method).toBe('GET');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${FAKE_ACCESS_TOKEN}`,
      });
      expect(init.signal).toBeInstanceOf(AbortSignal); // its own (short) timeout
      expect(details).toEqual({
        paymentTypeId: 'credit_card',
        cardBrand: 'visa',
        cardLastFour: '6260',
        providerFeeAmount: 2912,
        providerTaxAmount: 957,
        netReceivedAmount: 46131,
        approvedAt: new Date('2026-09-18T11:05:28.000-04:00'),
        moneyReleaseAt: new Date('2026-09-18T11:05:28.000-04:00'),
      });
    });

    it('picks the record whose order reference matches when several share the external reference', async () => {
      const otherRecord = {
        ...PAYMENT_RECORD,
        card: { last_four_digits: '0000' },
        point_of_interaction: { references: [{ id: 'ORD_SOMETHING_ELSE' }] },
      };
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, searchBody(otherRecord, PAYMENT_RECORD)),
        ),
      );
      const { adapter } = makeAdapter();

      const details = await adapter.getTransactionDetails(
        'ORD_APPROVED',
        'engagement-1',
        CountryCode.CO,
      );

      expect(details?.cardLastFour).toBe('6260');
    });

    it('returns null — never a guess — when no record references the order yet', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(
            200,
            searchBody({
              ...PAYMENT_RECORD,
              point_of_interaction: { references: [{ id: 'ORD_OTHER' }] },
            }),
          ),
        ),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getTransactionDetails(
          'ORD_APPROVED',
          'engagement-1',
          CountryCode.CO,
        ),
      ).resolves.toBeNull();
    });

    it('returns null for an empty search result or an unexpected body shape', async () => {
      const { adapter } = makeAdapter();
      for (const body of [searchBody(), { results: 'nope' }, {}]) {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(200, body)),
        );
        await expect(
          adapter.getTransactionDetails(
            'ORD_APPROVED',
            'engagement-1',
            CountryCode.CO,
          ),
        ).resolves.toBeNull();
      }
    });

    it('URL-encodes the external reference', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(200, searchBody())),
      );
      const { adapter } = makeAdapter();

      await adapter.getTransactionDetails(
        'ORD_APPROVED',
        'a b&c=d',
        CountryCode.CO,
      );

      expect((fetchMock.mock.calls[0] as [string])[0]).toContain(
        'external_reference=a%20b%26c%3Dd&',
      );
    });

    it.each([
      ['a malformed order id', '../x', 'engagement-1'],
      ['an empty order id', '', 'engagement-1'],
      ['an empty external reference', 'ORD_APPROVED', ''],
    ])(
      'returns null for %s WITHOUT calling the provider',
      async (_label, orderId, reference) => {
        const { adapter } = makeAdapter();

        await expect(
          adapter.getTransactionDetails(orderId, reference, CountryCode.CO),
        ).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it.each([[500], [502], [429]])(
      'maps HTTP %i to PaymentProviderUnavailableError (the caller treats it as "unknown")',
      async (status) => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(status, {})),
        );
        const { adapter } = makeAdapter();

        await expect(
          adapter.getTransactionDetails(
            'ORD_APPROVED',
            'engagement-1',
            CountryCode.CO,
          ),
        ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
      },
    );

    it('maps a 401 to PaymentProviderNotConfiguredError', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(401, {})),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getTransactionDetails(
          'ORD_APPROVED',
          'engagement-1',
          CountryCode.CO,
        ),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
    });

    it('never returns personal data even if the provider record carries it', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(
            200,
            searchBody({
              ...PAYMENT_RECORD,
              card: {
                last_four_digits: '6260',
                cardholder: {
                  name: 'APRO',
                  identification: { number: '123456789' },
                },
              },
              payer: {
                email: 'someone@example.com',
                phone: { number: '3001112222' },
              },
            }),
          ),
        ),
      );
      const { adapter } = makeAdapter();

      const details = await adapter.getTransactionDetails(
        'ORD_APPROVED',
        'engagement-1',
        CountryCode.CO,
      );

      expect(JSON.stringify(details)).not.toMatch(
        /APRO|123456789|someone@example|3001112222/,
      );
    });

    // GOS-142 — a WALLET id (numeric) takes a DIFFERENT path: a direct
    // `GET /v1/payments/{id}`, no search. See `PAYMENT_ID_PATTERN`'s own
    // comment on why this is checked before the order-id branch above.
    describe('a numeric providerPaymentId (wallet flow) reads the record directly', () => {
      const WALLET_PAYMENT_RECORD = {
        id: 178687128941,
        status: 'approved',
        external_reference: 'engagement-1',
        payment_type_id: 'account_money',
        transaction_details: { net_received_amount: 48500 },
        date_approved: '2026-09-19T10:00:00.000-05:00',
      };

      it('GETs /v1/payments/{id} directly, with its own short timeout, and maps the record', async () => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(200, WALLET_PAYMENT_RECORD)),
        );
        const { adapter } = makeAdapter();

        const details = await adapter.getTransactionDetails(
          '178687128941',
          'engagement-1',
          CountryCode.CO,
        );

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(
          'https://api.mercadopago.com/v1/payments/178687128941',
        );
        expect(init.method).toBe('GET');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(details).toEqual({
          paymentTypeId: 'account_money',
          cardBrand: null, // account_money has no card
          cardLastFour: null,
          providerFeeAmount: null,
          providerTaxAmount: null,
          netReceivedAmount: 48500,
          approvedAt: new Date('2026-09-19T10:00:00.000-05:00'),
          moneyReleaseAt: null,
        });
      });

      it('returns null — never a guess — when the record external_reference does not match EXACTLY', async () => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(
            jsonResponse(200, {
              ...WALLET_PAYMENT_RECORD,
              external_reference: 'some-other-engagement',
            }),
          ),
        );
        const { adapter } = makeAdapter();

        await expect(
          adapter.getTransactionDetails(
            '178687128941',
            'engagement-1',
            CountryCode.CO,
          ),
        ).resolves.toBeNull();
      });

      it('returns null for an unknown payment (404)', async () => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(404, {})),
        );
        const { adapter } = makeAdapter();

        await expect(
          adapter.getTransactionDetails(
            '178687128941',
            'engagement-1',
            CountryCode.CO,
          ),
        ).resolves.toBeNull();
      });

      it('maps a 401 to PaymentProviderNotConfiguredError', async () => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(401, {})),
        );
        const { adapter } = makeAdapter();

        await expect(
          adapter.getTransactionDetails(
            '178687128941',
            'engagement-1',
            CountryCode.CO,
          ),
        ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
      });

      it('maps a 5xx to PaymentProviderUnavailableError', async () => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(jsonResponse(503, {})),
        );
        const { adapter } = makeAdapter();

        await expect(
          adapter.getTransactionDetails(
            '178687128941',
            'engagement-1',
            CountryCode.CO,
          ),
        ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
      });
    });
  });

  describe('getPayment', () => {
    it('GETs the order and maps it, carrying externalReference/amount/currency', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(200, APPROVED_BODY)),
      );
      const { adapter } = makeAdapter();

      const snapshot = await adapter.getPayment('ORD_APPROVED', CountryCode.CO);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.mercadopago.com/v1/orders/ORD_APPROVED');
      expect(init.method).toBe('GET');
      expect(snapshot).toEqual({
        providerPaymentId: 'ORD_APPROVED',
        status: 'approved',
        externalReference: 'engagement-1',
        amount: 50000,
        currency: 'COP',
      });
    });

    it('returns null for an unknown order (404)', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(404, { errors: [{ code: 'not_found' }] })),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getPayment('ORD_UNKNOWN', CountryCode.CO),
      ).resolves.toBeNull();
    });

    it.each([['../etc/passwd'], ['ORD 1'], ['ORD/1?x=y'], ['']])(
      'returns null for a malformed id %p WITHOUT calling the provider',
      async (id) => {
        const { adapter } = makeAdapter();

        await expect(
          adapter.getPayment(id, CountryCode.CO),
        ).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('maps a 5xx to PaymentProviderUnavailableError', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(503, {})),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getPayment('ORD_X', CountryCode.CO),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it('maps a 401 to PaymentProviderNotConfiguredError', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(401, {})),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getPayment('ORD_X', CountryCode.CO),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
    });
  });

  // GOS-142 — the wallet flow's own status source of truth. NOT live-verified
  // (see this adapter's own header comment) — written against Mercado Pago's
  // documented Payments API status vocabulary only.
  describe('getPaymentByPaymentId (wallet flow — GET /v1/payments/{id})', () => {
    const APPROVED_PAYMENT_RECORD = {
      id: 178687128941,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: 'engagement-1',
      transaction_amount: 50000,
      currency_id: 'COP',
      payment_type_id: 'account_money',
    };

    it('GETs the payment directly and maps it, stringifying the numeric id', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(200, APPROVED_PAYMENT_RECORD)),
      );
      const { adapter } = makeAdapter();

      const snapshot = await adapter.getPaymentByPaymentId(
        '178687128941',
        CountryCode.CO,
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.mercadopago.com/v1/payments/178687128941');
      expect(init.method).toBe('GET');
      expect(snapshot).toEqual({
        providerPaymentId: '178687128941',
        status: 'approved',
        externalReference: 'engagement-1',
        amount: 50000,
        currency: 'COP',
      });
    });

    it('maps a rejected payment with its bucketed reason', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, {
            ...APPROVED_PAYMENT_RECORD,
            status: 'rejected',
            status_detail: 'cc_rejected_insufficient_amount',
          }),
        ),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getPaymentByPaymentId('178687128941', CountryCode.CO),
      ).resolves.toEqual({
        providerPaymentId: '178687128941',
        status: 'rejected',
        rejectionReason: 'INSUFFICIENT_FUNDS',
        externalReference: 'engagement-1',
        amount: 50000,
        currency: 'COP',
      });
    });

    it.each([['pending'], ['in_process'], ['authorized'], ['in_mediation']])(
      'maps a %s payment status to pending',
      async (status) => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(
            jsonResponse(200, { ...APPROVED_PAYMENT_RECORD, status }),
          ),
        );
        const { adapter } = makeAdapter();

        await expect(
          adapter.getPaymentByPaymentId('178687128941', CountryCode.CO),
        ).resolves.toMatchObject({ status: 'pending' });
      },
    );

    it.each([['refunded'], ['charged_back']])(
      'maps an out-of-scope %s status to pending — never re-reports it as approved or rejected',
      async (status) => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(
            jsonResponse(200, { ...APPROVED_PAYMENT_RECORD, status }),
          ),
        );
        const { adapter } = makeAdapter();

        await expect(
          adapter.getPaymentByPaymentId('178687128941', CountryCode.CO),
        ).resolves.toMatchObject({ status: 'pending' });
      },
    );

    it.each([['ORD_APPROVED'], ['not-a-number'], ['']])(
      'returns null for a non-numeric id %p WITHOUT calling the provider',
      async (id) => {
        const { adapter } = makeAdapter();

        await expect(
          adapter.getPaymentByPaymentId(id, CountryCode.CO),
        ).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('returns null for an unknown payment (404)', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(404, { errors: [{ code: 'not_found' }] })),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getPaymentByPaymentId('178687128941', CountryCode.CO),
      ).resolves.toBeNull();
    });

    it('maps a 5xx to PaymentProviderUnavailableError', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(503, {})),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getPaymentByPaymentId('178687128941', CountryCode.CO),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it('maps a 401 to PaymentProviderNotConfiguredError', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(401, {})),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getPaymentByPaymentId('178687128941', CountryCode.CO),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
    });

    it('treats a 2xx without a usable payment id as unknown outcome, not "unknown payment" (null)', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { status: 'approved' })),
      );
      const { adapter } = makeAdapter();

      await expect(
        adapter.getPaymentByPaymentId('178687128941', CountryCode.CO),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });
  });

  // GOS-142 — starts a wallet payment. Live-verified path/format details are
  // called out inline; everything else is per the port's documented contract.
  describe('createWalletPreference (POST /checkout/preferences)', () => {
    const PREFERENCE_RESPONSE = {
      id: '1534142261-abc12345-6789-def0-1234-56789abcdef0',
      init_point: 'https://www.mercadopago.com/checkout/v1/redirect?pref_id=x',
      sandbox_init_point:
        'https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=x',
    };

    it('POSTs to /checkout/preferences (no /v1/ prefix) with wallet_purchase and unit_price as a plain integer', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, PREFERENCE_RESPONSE)),
      );
      const { adapter } = makeAdapter(WALLET_CHECKOUT_SETTINGS);

      await adapter.createWalletPreference(WALLET_COMMAND);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${FAKE_ACCESS_TOKEN}`,
      });
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).toEqual({
        items: [
          {
            title: 'Engagement payment',
            quantity: 1,
            currency_id: 'COP',
            unit_price: 50000, // a plain integer, NOT formatMercadoPagoAmount's zero-decimal string
          },
        ],
        purpose: 'wallet_purchase',
        external_reference: 'engagement-1',
        payer: { email: 'buyer@example.com' },
        back_urls: {
          success: 'https://app.goservice.example/payments/success',
          pending: 'https://app.goservice.example/payments/pending',
          failure: 'https://app.goservice.example/payments/failure',
        },
        notification_url:
          'https://api.goservice.example/webhooks/mercadopago/payments/co',
      });
    });

    it('returns the SANDBOX redirect URL under sandbox credentials', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, PREFERENCE_RESPONSE)),
      );
      const { adapter } = makeAdapter(WALLET_CHECKOUT_SETTINGS);

      await expect(
        adapter.createWalletPreference(WALLET_COMMAND),
      ).resolves.toEqual({
        preferenceId: PREFERENCE_RESPONSE.id,
        redirectUrl: PREFERENCE_RESPONSE.sandbox_init_point,
      });
    });

    it('returns the PRODUCTION redirect URL under production credentials — never sandbox_init_point', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, PREFERENCE_RESPONSE)),
      );
      const { adapter } = makeAdapter({
        ...WALLET_CHECKOUT_SETTINGS,
        'payments.payment-methods.mercadopago.co.environment': 'production',
      });

      await expect(
        adapter.createWalletPreference(WALLET_COMMAND),
      ).resolves.toEqual({
        preferenceId: PREFERENCE_RESPONSE.id,
        redirectUrl: PREFERENCE_RESPONSE.init_point,
      });
    });

    it('derives notification_url from the public base URL PLUS the country segment', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(201, PREFERENCE_RESPONSE)),
      );
      const { adapter } = makeAdapter({
        ...WALLET_CHECKOUT_SETTINGS,
        'payments.general-settings.callbacks.public-base-url':
          'https://api.goservice.example/', // trailing slash tolerated
      });

      await adapter.createWalletPreference(WALLET_COMMAND);

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as { notification_url: string };
      expect(body.notification_url).toBe(
        'https://api.goservice.example/webhooks/mercadopago/payments/co',
      );
    });

    it.each([
      [
        'public base URL missing',
        { 'payments.general-settings.callbacks.public-base-url': null },
      ],
      [
        'success back URL missing',
        {
          'payments.payment-methods.mercadopago.wallet.back-url-success': null,
        },
      ],
      [
        'pending back URL blank',
        {
          'payments.payment-methods.mercadopago.wallet.back-url-pending': '   ',
        },
      ],
      [
        'failure back URL missing',
        {
          'payments.payment-methods.mercadopago.wallet.back-url-failure': null,
        },
      ],
    ])(
      'fails closed BEFORE any HTTP call when wallet checkout config is incomplete: %s',
      async (_label, override) => {
        const { adapter } = makeAdapter({
          ...WALLET_CHECKOUT_SETTINGS,
          ...override,
        });

        await expect(
          adapter.createWalletPreference(WALLET_COMMAND),
        ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('maps 401/403 to PaymentProviderNotConfiguredError', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(401, {})),
      );
      const { adapter } = makeAdapter(WALLET_CHECKOUT_SETTINGS);

      await expect(
        adapter.createWalletPreference(WALLET_COMMAND),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
    });

    it('maps any other non-2xx to PaymentProviderUnavailableError — there is no "rejected" outcome at this step', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse(400, { errors: [{ code: 'x' }] })),
      );
      const { adapter } = makeAdapter(WALLET_CHECKOUT_SETTINGS);

      await expect(
        adapter.createWalletPreference(WALLET_COMMAND),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });

    it('treats a 2xx without a usable id/redirect URL as unavailable', async () => {
      fetchMock.mockImplementation(
        () => Promise.resolve(jsonResponse(201, { id: 'pref-1' })), // no init_point/sandbox_init_point
      );
      const { adapter } = makeAdapter(WALLET_CHECKOUT_SETTINGS);

      await expect(
        adapter.createWalletPreference(WALLET_COMMAND),
      ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    });
  });
});

describe('MercadoPagoPaymentAdapter — empty/garbled 2xx bodies', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function adapterWith(body: BodyInit | null) {
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response(body, { status: 200 })),
    );
    return new MercadoPagoPaymentAdapter({
      getValue: (key: string) =>
        Promise.resolve(
          key === 'payments.payment-methods.mercadopago.co.environment'
            ? 'sandbox'
            : 'APP_USR-x',
        ),
    } as unknown as PlatformSettingPort);
  }

  it('chargeCard: a 2xx with a JSON `null` body is an unknown outcome, not a TypeError', async () => {
    await expect(
      adapterWith('null').chargeCard(COMMAND),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
  });

  it('getPayment: a 2xx with no usable order is unavailable — NOT "unknown order" (null)', async () => {
    await expect(
      adapterWith('').getPayment('ORD_X', CountryCode.CO),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
  });
});
