import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PaymentAttemptStatus, PaymentMethod } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { RapydPaymentAdapter } from '../adapters/rapyd-payment.adapter';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import type {
  ProviderCheckoutSnapshot,
  ProviderPaymentSnapshot,
} from '../ports/payment-provider.port';
import { signRapydRequest } from '../utils/rapyd-signature.util';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { HandleRapydNotificationService } from './handle-rapyd-notification.service';

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';
const ACCESS_KEY = 'rak_unit_access';
const SECRET_KEY = 'rsk_unit_secret';
const PUBLIC_BASE_URL = 'https://api.goservice.example';

function makeAttempt(overrides?: Record<string, unknown>) {
  return {
    id: 'attempt-1',
    engagementId: ENGAGEMENT_ID,
    method: PaymentMethod.RAPYD,
    status: PaymentAttemptStatus.PENDING,
    providerPaymentId: null,
    providerCheckoutId: 'checkout_1',
    amount: 50000,
    currency: 'ARS',
    ...overrides,
  };
}

function makeCheckout(
  overrides?: Partial<ProviderCheckoutSnapshot>,
): ProviderCheckoutSnapshot {
  return {
    checkoutId: 'checkout_1',
    status: 'approved',
    providerPaymentId: 'payment_1',
    externalReference: ENGAGEMENT_ID,
    amount: 50000,
    currency: 'ARS',
    paymentCreated: true,
    open: false,
    ...overrides,
  };
}

function makePayment(
  overrides?: Partial<ProviderPaymentSnapshot>,
): ProviderPaymentSnapshot {
  return {
    providerPaymentId: 'payment_1',
    status: 'approved',
    externalReference: ENGAGEMENT_ID,
    amount: 50000,
    currency: 'ARS',
    ...overrides,
  };
}

const payload = (id: string) => ({
  id: 'wh_1',
  type: 'PAYMENT_COMPLETED',
  // The claimed status in the body must never matter.
  data: { id, status: 'CLO', paid: true, amount: 1 },
});

describe('HandleRapydNotificationService', () => {
  let errorLog: jest.SpyInstance;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => errorLog.mockClear());

  function makeService(options?: {
    settings?: Record<string, string | null>;
    byCheckoutId?: unknown;
    byPaymentId?: unknown;
    byEngagement?: unknown;
    payment?: ProviderPaymentSnapshot | null;
    checkout?: ProviderCheckoutSnapshot | null;
    charge?: ProviderPaymentSnapshot | null;
    readError?: Error;
  }) {
    const values: Record<string, string | null> = {
      'payments.payment-methods.rapyd.access-key': ACCESS_KEY,
      'payments.payment-methods.rapyd.secret-key': SECRET_KEY,
      'payments.general-settings.callbacks.public-base-url': PUBLIC_BASE_URL,
      ...options?.settings,
    };
    const getValue = jest.fn((key: string) =>
      Promise.resolve(values[key] ?? null),
    );
    const platformSettingPort = { getValue } as unknown as PlatformSettingPort;

    const readPayment = jest
      .fn()
      .mockResolvedValue(
        options?.payment === undefined ? makePayment() : options.payment,
      );
    const getCheckoutSnapshot = options?.readError
      ? jest.fn().mockRejectedValue(options.readError)
      : jest
          .fn()
          .mockResolvedValue(
            options?.checkout === undefined ? makeCheckout() : options.checkout,
          );
    const readSavedCardCharge = jest
      .fn()
      .mockResolvedValue(options?.charge === undefined ? null : options.charge);
    const rapydAdapter = {
      readPayment,
      getCheckoutSnapshot,
      readSavedCardCharge,
    } as unknown as RapydPaymentAdapter;

    const findByProviderCheckoutId = jest
      .fn()
      .mockResolvedValue(
        options?.byCheckoutId === undefined
          ? makeAttempt()
          : options.byCheckoutId,
      );
    const findByProviderPaymentId = jest
      .fn()
      .mockResolvedValue(
        options?.byPaymentId === undefined ? null : options.byPaymentId,
      );
    const findPendingByEngagementIdAndMethod = jest
      .fn()
      .mockResolvedValue(
        options?.byEngagement === undefined
          ? makeAttempt()
          : options.byEngagement,
      );
    const repository = {
      findByProviderCheckoutId,
      findByProviderPaymentId,
      findPendingByEngagementIdAndMethod,
    } as unknown as PaymentAttemptRepository;

    const apply = jest.fn().mockResolvedValue(makeAttempt());
    const applyService = { apply } as unknown as ApplyPaymentResultService;

    const service = new HandleRapydNotificationService(
      platformSettingPort,
      rapydAdapter,
      repository,
      applyService,
    );
    return {
      service,
      getValue,
      readPayment,
      getCheckoutSnapshot,
      readSavedCardCharge,
      findByProviderCheckoutId,
      findByProviderPaymentId,
      findPendingByEngagementIdAndMethod,
      apply,
    };
  }

  describe('isSignatureValid', () => {
    // ONE webhook URL for the whole (multi-country) Rapyd account.
    const WEBHOOK_URL = `${PUBLIC_BASE_URL}/webhooks/rapyd`;
    const RAW_BODY = JSON.stringify(payload('payment_1'));

    function signed(url = WEBHOOK_URL, body = RAW_BODY) {
      const salt = 'unitsalt01';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const hex = createHmac('sha256', SECRET_KEY)
        .update(url + salt + timestamp + ACCESS_KEY + SECRET_KEY + body)
        .digest('hex');
      return {
        salt,
        timestamp,
        signature: Buffer.from(hex).toString('base64'),
        rawBody: body,
      };
    }

    it('accepts a webhook signed over <public base URL>/webhooks/rapyd with the account keys', async () => {
      const m = makeService();

      await expect(m.service.isSignatureValid(signed())).resolves.toBe(true);
      expect(m.getValue).toHaveBeenCalledWith(
        'payments.payment-methods.rapyd.secret-key',
      );
    });

    it('rejects a signature made for a DIFFERENT URL (the old per-country path, or another host)', async () => {
      const m = makeService();

      await expect(
        m.service.isSignatureValid(signed(`${WEBHOOK_URL}/co`)),
      ).resolves.toBe(false);
      await expect(
        m.service.isSignatureValid(
          signed('https://evil.example/webhooks/rapyd'),
        ),
      ).resolves.toBe(false);
    });

    it('rejects a tampered body and a request-style signature', async () => {
      const m = makeService();
      const good = signed();

      await expect(
        m.service.isSignatureValid({
          ...good,
          rawBody: good.rawBody.replace('payment_1', 'payment_9'),
        }),
      ).resolves.toBe(false);

      const requestStyle = signRapydRequest({
        method: 'post',
        urlPath: '/webhooks/rapyd',
        body: RAW_BODY,
        accessKey: ACCESS_KEY,
        secretKey: SECRET_KEY,
      });
      await expect(
        m.service.isSignatureValid({ ...requestStyle, rawBody: RAW_BODY }),
      ).resolves.toBe(false);
    });

    it.each([
      ['the access key', { 'payments.payment-methods.rapyd.access-key': null }],
      ['the secret key', { 'payments.payment-methods.rapyd.secret-key': null }],
      [
        'the public base URL',
        { 'payments.general-settings.callbacks.public-base-url': null },
      ],
    ])(
      'fails CLOSED when %s is not configured — never accepts',
      async (_label, settings) => {
        const m = makeService({ settings });

        await expect(m.service.isSignatureValid(signed())).resolves.toBe(false);
      },
    );

    it('does NOT reject a stale timestamp (Rapyd documents no replay window; the body is never trusted anyway)', async () => {
      const m = makeService();
      const old = signed();
      const staleTs = String(Math.floor(Date.now() / 1000) - 3600);
      const hex = createHmac('sha256', SECRET_KEY)
        .update(
          WEBHOOK_URL + old.salt + staleTs + ACCESS_KEY + SECRET_KEY + RAW_BODY,
        )
        .digest('hex');

      await expect(
        m.service.isSignatureValid({
          ...old,
          timestamp: staleTs,
          signature: Buffer.from(hex).toString('base64'),
        }),
      ).resolves.toBe(true);
    });

    it('tolerates a trailing slash on the configured base URL', async () => {
      const m = makeService({
        settings: {
          'payments.general-settings.callbacks.public-base-url': `${PUBLIC_BASE_URL}/`,
        },
      });

      await expect(m.service.isSignatureValid(signed())).resolves.toBe(true);
    });
  });

  describe('execute', () => {
    it('NEVER trusts the body: it re-reads the real state and applies THAT, not the claimed CLO/paid', async () => {
      const m = makeService({
        checkout: makeCheckout({
          status: 'pending',
          providerPaymentId: null,
          paymentCreated: false,
          open: true,
        }),
      });

      await m.service.execute({ payload: payload('checkout_1') });

      expect(m.getCheckoutSnapshot).toHaveBeenCalledTimes(1);
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'pending',
        providerPaymentId: null,
        rejectionReason: undefined,
      });
    });

    it('a checkout id is correlated by providerCheckoutId; an approved re-read is applied with the payment id it reveals', async () => {
      const m = makeService();

      await m.service.execute({ payload: payload('checkout_1') });

      expect(m.findByProviderCheckoutId).toHaveBeenCalledWith(
        'checkout_1',
        PaymentMethod.RAPYD,
      );
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'approved',
        providerPaymentId: 'payment_1',
        rejectionReason: undefined,
      });
    });

    it('a saved-card charge (payment id, no checkout) is re-read terminal-aware: a FAILED one is REJECTED, never left PENDING', async () => {
      const m = makeService({
        byPaymentId: makeAttempt({
          providerPaymentId: 'payment_1',
          providerCheckoutId: null,
        }),
        charge: makePayment({
          status: 'rejected',
          rejectionReason: 'CARD_DECLINED',
        }),
      });

      await m.service.execute({ payload: payload('payment_1') });

      expect(m.readSavedCardCharge).toHaveBeenCalledWith('payment_1');
      expect(m.getCheckoutSnapshot).not.toHaveBeenCalled();
      expect(m.readPayment).not.toHaveBeenCalled();
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: 'payment_1',
        rejectionReason: 'CARD_DECLINED',
      });
    });

    it('a payment id is correlated by providerPaymentId first', async () => {
      const m = makeService({
        byPaymentId: makeAttempt({ providerPaymentId: 'payment_1' }),
      });

      await m.service.execute({ payload: payload('payment_1') });

      expect(m.findByProviderPaymentId).toHaveBeenCalledWith(
        'payment_1',
        PaymentMethod.RAPYD,
      );
      expect(m.readPayment).not.toHaveBeenCalled(); // no need to ask Rapyd whose it is
      expect(m.apply).toHaveBeenCalledTimes(1);
    });

    it('an unlinked payment is correlated by the merchant reference (Engagement.id) Rapyd echoes, validated as a UUID', async () => {
      const m = makeService({ byPaymentId: null });

      await m.service.execute({ payload: payload('payment_1') });

      expect(m.readPayment).toHaveBeenCalledWith('payment_1');
      expect(m.findPendingByEngagementIdAndMethod).toHaveBeenCalledWith(
        ENGAGEMENT_ID,
        PaymentMethod.RAPYD,
      );
      expect(m.apply).toHaveBeenCalledTimes(1);
    });

    it('a NON-UUID merchant reference never reaches Postgres — the notification is ignored', async () => {
      const m = makeService({
        byPaymentId: null,
        payment: makePayment({ externalReference: "1'; DROP TABLE x;--" }),
      });

      await m.service.execute({ payload: payload('payment_1') });

      expect(m.findPendingByEngagementIdAndMethod).not.toHaveBeenCalled();
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('never approves an amount/currency that does not reconcile — logged as an error, nothing applied', async () => {
      const m = makeService({ checkout: makeCheckout({ amount: 49999 }) });

      await m.service.execute({ payload: payload('checkout_1') });

      expect(m.apply).not.toHaveBeenCalled();
      expect(JSON.stringify(errorLog.mock.calls)).toContain(
        'rapyd_payment_amount_mismatch',
      );
    });

    it('a REJECTED state (expired / blocked checkout) is applied as rejected with its reason', async () => {
      const m = makeService({
        checkout: makeCheckout({
          status: 'rejected',
          rejectionReason: 'OTHER',
          providerPaymentId: null,
          paymentCreated: false,
        }),
      });

      await m.service.execute({ payload: payload('checkout_1') });

      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'OTHER',
      });
    });

    it('an attempt that never learned its checkout id is approved directly from the PAID payment', async () => {
      const m = makeService({
        byPaymentId: null,
        byEngagement: makeAttempt({ providerCheckoutId: null }),
      });

      await m.service.execute({ payload: payload('payment_1') });

      expect(m.getCheckoutSnapshot).not.toHaveBeenCalled();
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'approved',
        providerPaymentId: 'payment_1',
        rejectionReason: undefined,
      });
    });

    it('a paid payment that belongs to ANOTHER (older) checkout than the matched attempt is applied to nothing and logged for an operator', async () => {
      const m = makeService({
        byPaymentId: null,
        checkout: makeCheckout({
          status: 'pending',
          providerPaymentId: 'payment_other',
          open: true,
        }),
      });

      await m.service.execute({ payload: payload('payment_1') });

      expect(JSON.stringify(errorLog.mock.calls)).toContain(
        'rapyd_payment_for_other_checkout',
      );
      // Applied state is the attempt's OWN checkout's — pending — never the stray payment's.
      expect(m.apply).toHaveBeenCalledWith(
        'attempt-1',
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it.each([
      ['an unknown attempt', { byCheckoutId: null }],
      ['a resource Rapyd does not know', { checkout: null }],
    ])('ignores %s without applying anything', async (_label, options) => {
      const m = makeService(options);

      await m.service.execute({ payload: payload('checkout_1') });

      expect(m.apply).not.toHaveBeenCalled();
    });

    it.each([
      ['a non-Rapyd id', { data: { id: 'ORD123' } }],
      ['no data', {}],
      ['a non-object payload', 'oops'],
      ['null', null],
    ])('ignores %s', async (_label, body) => {
      const m = makeService();

      await m.service.execute({ payload: body });

      expect(m.findByProviderCheckoutId).not.toHaveBeenCalled();
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('lets a Rapyd/DB failure surface (so the webhook is answered 5xx and Rapyd retries)', async () => {
      const boom = new Error('rapyd down');
      const m = makeService({ readError: boom });

      await expect(
        m.service.execute({ payload: payload('checkout_1') }),
      ).rejects.toBe(boom);
    });
  });
});
