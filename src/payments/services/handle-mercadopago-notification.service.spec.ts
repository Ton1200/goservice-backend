import { Logger } from '@nestjs/common';
import { CountryCode } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import {
  PaymentProviderPort,
  PaymentProviderUnavailableError,
  ProviderPaymentSnapshot,
} from '../ports/payment-provider.port';
import {
  buildMercadoPagoSignatureManifest,
  computeMercadoPagoSignature,
} from '../utils/mercadopago-signature.util';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { HandleMercadoPagoNotificationService } from './handle-mercadopago-notification.service';

const ENGAGEMENT_ID = '6f1c1c0e-3b9a-4d0a-9a53-0d1f8a7b2c11';
const SECRET = 'unit-test-webhook-secret'; // synthetic

const ATTEMPT = {
  id: 'attempt-1',
  engagementId: ENGAGEMENT_ID,
  amount: 50000,
  currency: 'COP',
};

function snapshot(
  overrides?: Partial<ProviderPaymentSnapshot>,
): ProviderPaymentSnapshot {
  return {
    providerPaymentId: 'ORD_1',
    status: 'approved',
    externalReference: ENGAGEMENT_ID,
    amount: 50000,
    currency: 'COP',
    ...overrides,
  };
}

describe('HandleMercadoPagoNotificationService', () => {
  let errorLog: jest.SpyInstance;
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => errorLog.mockClear());

  function makeService(options?: {
    secret?: string | null;
    snapshot?: ProviderPaymentSnapshot | null;
    getPaymentError?: Error;
    byProviderId?: object | null;
    byEngagement?: object | null;
  }) {
    const getValue = jest
      .fn()
      .mockResolvedValue(
        options?.secret === undefined ? SECRET : options.secret,
      );
    const platformSettingPort = { getValue } as unknown as PlatformSettingPort;

    const getPayment = options?.getPaymentError
      ? jest.fn().mockRejectedValue(options.getPaymentError)
      : jest
          .fn()
          .mockResolvedValue(
            options?.snapshot === undefined ? snapshot() : options.snapshot,
          );
    const paymentProvider = { getPayment } as unknown as PaymentProviderPort;

    const findByProviderPaymentId = jest
      .fn()
      .mockResolvedValue(
        options?.byProviderId === undefined ? ATTEMPT : options.byProviderId,
      );
    const findPendingWithoutProviderIdByEngagementId = jest
      .fn()
      .mockResolvedValue(
        options?.byEngagement === undefined ? null : options.byEngagement,
      );
    const repository = {
      findByProviderPaymentId,
      findPendingWithoutProviderIdByEngagementId,
    } as unknown as PaymentAttemptRepository;

    const apply = jest.fn().mockResolvedValue(ATTEMPT);
    const applyService = { apply } as unknown as ApplyPaymentResultService;

    const service = new HandleMercadoPagoNotificationService(
      platformSettingPort,
      paymentProvider,
      repository,
      applyService,
    );
    return {
      service,
      getPayment,
      findByProviderPaymentId,
      findPendingWithoutProviderIdByEngagementId,
      apply,
    };
  }

  describe('isSignatureValid', () => {
    const dataId = 'ORD01M28P44G5FG8RJPM579EH56FV';
    const requestId = 'req-1';
    const ts = '1742505638683';
    const goodHeader = `ts=${ts},v1=${computeMercadoPagoSignature(
      SECRET,
      buildMercadoPagoSignatureManifest({ dataId, xRequestId: requestId, ts }),
    )}`;

    it('accepts a correctly signed request', async () => {
      const { service } = makeService();
      await expect(
        service.isSignatureValid(
          {
            xSignature: goodHeader,
            xRequestId: requestId,
            dataId,
          },
          CountryCode.CO,
        ),
      ).resolves.toBe(true);
    });

    it('rejects a wrong signature', async () => {
      const { service } = makeService();
      await expect(
        service.isSignatureValid(
          {
            xSignature: `ts=${ts},v1=deadbeef`,
            xRequestId: requestId,
            dataId,
          },
          CountryCode.CO,
        ),
      ).resolves.toBe(false);
    });

    it('FAILS CLOSED when the webhook secret is not configured', async () => {
      const { service } = makeService({ secret: null });
      await expect(
        service.isSignatureValid(
          {
            xSignature: goodHeader,
            xRequestId: requestId,
            dataId,
          },
          CountryCode.CO,
        ),
      ).resolves.toBe(false);
    });
  });

  describe('execute', () => {
    it('re-reads the order from the provider, finds the attempt by the provider id, and applies the RE-READ status (never the body)', async () => {
      const m = makeService();

      await m.service.execute({
        dataId: 'ORD_1',
        type: 'order',
        country: CountryCode.CO,
      });

      expect(m.getPayment).toHaveBeenCalledWith('ORD_1', CountryCode.CO);
      expect(m.findByProviderPaymentId).toHaveBeenCalledWith('ORD_1');
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
        rejectionReason: undefined,
      });
    });

    it('applies a rejection with its reason', async () => {
      const m = makeService({
        snapshot: snapshot({
          status: 'rejected',
          rejectionReason: 'CARD_DECLINED',
        }),
      });

      await m.service.execute({
        dataId: 'ORD_1',
        type: 'order',
        country: CountryCode.CO,
      });

      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: 'ORD_1',
        rejectionReason: 'CARD_DECLINED',
      });
    });

    it('passes a still-pending order through as pending (the apply function no-ops it)', async () => {
      const m = makeService({ snapshot: snapshot({ status: 'pending' }) });

      await m.service.execute({
        dataId: 'ORD_1',
        type: 'order',
        country: CountryCode.CO,
      });

      expect(m.apply).toHaveBeenCalledWith(
        'attempt-1',
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it("adopts the Engagement's PENDING attempt via external_reference when no attempt has this provider id (lost create response)", async () => {
      const m = makeService({ byProviderId: null, byEngagement: ATTEMPT });

      await m.service.execute({
        dataId: 'ORD_1',
        type: 'order',
        country: CountryCode.CO,
      });

      expect(m.findPendingWithoutProviderIdByEngagementId).toHaveBeenCalledWith(
        ENGAGEMENT_ID,
      );
      expect(m.apply).toHaveBeenCalledWith(
        'attempt-1',
        expect.objectContaining({ providerPaymentId: 'ORD_1' }),
      );
    });

    it('does NOT query by a non-UUID external_reference (would make Postgres throw on the uuid column)', async () => {
      const m = makeService({
        byProviderId: null,
        snapshot: snapshot({ externalReference: 'some-other-flow-ref' }),
      });

      await m.service.execute({
        dataId: 'ORD_1',
        type: 'order',
        country: CountryCode.CO,
      });

      expect(
        m.findPendingWithoutProviderIdByEngagementId,
      ).not.toHaveBeenCalled();
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('is a no-op for an order that matches no attempt (not ours)', async () => {
      const m = makeService({ byProviderId: null, byEngagement: null });

      await expect(
        m.service.execute({
          dataId: 'ORD_1',
          type: 'order',
          country: CountryCode.CO,
        }),
      ).resolves.toBeUndefined();
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('ignores any topic other than `order` without calling the provider', async () => {
      const m = makeService();

      await m.service.execute({
        dataId: 'ORD_1',
        type: 'payment',
        country: CountryCode.CO,
      });
      await m.service.execute({
        dataId: 'ORD_1',
        type: null,
        country: CountryCode.CO,
      });

      expect(m.getPayment).not.toHaveBeenCalled();
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('is a no-op when the provider does not know the order', async () => {
      const m = makeService({ snapshot: null });

      await m.service.execute({
        dataId: 'ORD_1',
        type: 'order',
        country: CountryCode.CO,
      });

      expect(m.apply).not.toHaveBeenCalled();
    });

    describe('amount cross-check on approval', () => {
      it.each([
        ['a different amount', { amount: 49999 }],
        ['an unknown amount', { amount: null }],
        ['a different currency', { currency: 'ARS' }],
        ['an unknown currency', { currency: null }],
      ])(
        'does NOT approve when the provider reports %s — and logs an error',
        async (_label, override) => {
          const m = makeService({ snapshot: snapshot(override) });

          await m.service.execute({
            dataId: 'ORD_1',
            type: 'order',
            country: CountryCode.CO,
          });

          expect(m.apply).not.toHaveBeenCalled();
          expect(JSON.stringify(errorLog.mock.calls)).toContain(
            'card_payment_amount_mismatch',
          );
        },
      );

      it('compares the currency case-insensitively', async () => {
        const m = makeService({ snapshot: snapshot({ currency: 'cop' }) });

        await m.service.execute({
          dataId: 'ORD_1',
          type: 'order',
          country: CountryCode.CO,
        });

        expect(m.apply).toHaveBeenCalledTimes(1);
      });

      it('does not require an amount match to REJECT', async () => {
        const m = makeService({
          snapshot: snapshot({
            status: 'rejected',
            amount: null,
            rejectionReason: 'OTHER',
          }),
        });

        await m.service.execute({
          dataId: 'ORD_1',
          type: 'order',
          country: CountryCode.CO,
        });

        expect(m.apply).toHaveBeenCalledTimes(1);
      });
    });

    it('does NOT swallow a provider outage — it surfaces so Mercado Pago retries the delivery', async () => {
      const boom = new PaymentProviderUnavailableError('HTTP 503');
      const m = makeService({ getPaymentError: boom });

      await expect(
        m.service.execute({
          dataId: 'ORD_1',
          type: 'order',
          country: CountryCode.CO,
        }),
      ).rejects.toBe(boom);
    });
  });
});
