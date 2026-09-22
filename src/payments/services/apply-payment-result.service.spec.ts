import { Logger } from '@nestjs/common';
import {
  CountryCode,
  PaymentAttemptStatus,
  PaymentMethod,
} from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { RecordDigitalPaymentService } from '../../ledger/services/record-digital-payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import type { ProviderTransactionDetails } from '../ports/payment-provider.port';
import { ApplyPaymentResultService } from './apply-payment-result.service';

const fakeTx = { __fakeTransactionClient: true } as never;

const DETAILS: ProviderTransactionDetails = {
  paymentTypeId: 'credit_card',
  cardBrand: 'visa',
  cardLastFour: '6260',
  providerFeeAmount: 2912,
  providerTaxAmount: 957,
  netReceivedAmount: 46131,
  approvedAt: new Date('2026-09-18T15:05:28.000Z'),
  moneyReleaseAt: new Date('2026-09-18T15:05:28.000Z'),
};

function makeAttempt(overrides?: Record<string, unknown>) {
  return {
    id: 'attempt-1',
    engagementId: 'engagement-1',
    method: PaymentMethod.MERCADOPAGO,
    status: PaymentAttemptStatus.PENDING,
    providerPaymentId: null,
    amount: 50000,
    currency: 'COP',
    installments: 1,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ApplyPaymentResultService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  function makeService(options?: {
    attempt?: ReturnType<typeof makeAttempt> | null;
    casCount?: number;
    engagement?: object | null;
    setMethodCount?: number;
    recordThrows?: Error;
    /** What the provider's best-effort details lookup answers (default: the real-shaped DETAILS). */
    details?: ProviderTransactionDetails | null;
    detailsThrows?: Error;
  }) {
    const attempt =
      options?.attempt === undefined ? makeAttempt() : options.attempt;
    const findById = jest.fn().mockResolvedValue(attempt);
    const resolveIfPending = jest
      .fn()
      .mockResolvedValue({ count: options?.casCount ?? 1 });
    const attachProviderPaymentIdIfPending = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    const paymentAttemptRepository = {
      findById,
      resolveIfPending,
      attachProviderPaymentIdIfPending,
    } as unknown as PaymentAttemptRepository;

    const findByIdWithBillingContext = jest.fn().mockResolvedValue(
      options?.engagement === undefined
        ? {
            customerProfileId: 'customer-1',
            professionalProfileId: 'professional-1',
            customerProfile: { country: CountryCode.CO },
          }
        : options.engagement,
    );
    const setPaymentMethodIfUnset = jest
      .fn()
      .mockResolvedValue({ count: options?.setMethodCount ?? 1 });
    const engagementsRepository = {
      findByIdWithBillingContext,
      setPaymentMethodIfUnset,
    } as unknown as EngagementsRepository;

    const recordDigitalPayment = options?.recordThrows
      ? jest.fn().mockRejectedValue(options.recordThrows)
      : jest.fn().mockResolvedValue(undefined);
    const recordDigitalPaymentService = {
      recordDigitalPayment,
    } as unknown as RecordDigitalPaymentService;

    const $transaction = jest.fn((cb: (tx: never) => Promise<unknown>) =>
      cb(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const getTransactionDetails = options?.detailsThrows
      ? jest.fn().mockRejectedValue(options.detailsThrows)
      : jest
          .fn()
          .mockResolvedValue(
            options?.details === undefined ? DETAILS : options.details,
          );
    const paymentProvider = {
      getTransactionDetails,
    };

    const forMethod = jest.fn().mockReturnValue(paymentProvider);
    const registry = { forMethod } as unknown as PaymentProviderRegistry;

    const service = new ApplyPaymentResultService(
      prisma,
      paymentAttemptRepository,
      engagementsRepository,
      recordDigitalPaymentService,
      registry,
    );
    return {
      service,
      forMethod,
      getTransactionDetails,
      findById,
      resolveIfPending,
      attachProviderPaymentIdIfPending,
      findByIdWithBillingContext,
      setPaymentMethodIfUnset,
      recordDigitalPayment,
      $transaction,
    };
  }

  describe('approved', () => {
    it('in ONE transaction: CAS to APPROVED, writes the ledger event from the FROZEN attempt amount, and sets paymentMethod = MERCADOPAGO', async () => {
      const m = makeService();

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      expect(m.$transaction).toHaveBeenCalledTimes(1);
      expect(m.resolveIfPending).toHaveBeenCalledWith(fakeTx, 'attempt-1', {
        status: 'APPROVED',
        providerPaymentId: 'ORD_1',
        rejectionReason: null,
        details: DETAILS,
      });
      expect(m.recordDigitalPayment).toHaveBeenCalledWith(fakeTx, {
        engagementId: 'engagement-1',
        quotedPrice: 50000,
        currency: 'COP',
        customerProfileId: 'customer-1',
        professionalProfileId: 'professional-1',
      });
      expect(m.setPaymentMethodIfUnset).toHaveBeenCalledWith(
        fakeTx,
        'engagement-1',
        PaymentMethod.MERCADOPAGO,
      );
    });

    it('is IDEMPOTENT: a lost CAS (attempt already resolved) writes NO ledger event and sets no method', async () => {
      const m = makeService({ casCount: 0 });

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      expect(m.resolveIfPending).toHaveBeenCalledTimes(1);
      expect(m.recordDigitalPayment).not.toHaveBeenCalled();
      expect(m.setPaymentMethodIfUnset).not.toHaveBeenCalled();
    });

    it('takes the fast path for an attempt already APPROVED — no transaction, no billing read, no writes', async () => {
      const m = makeService({
        attempt: makeAttempt({ status: PaymentAttemptStatus.APPROVED }),
      });

      const result = await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      expect(result?.status).toBe(PaymentAttemptStatus.APPROVED);
      expect(m.$transaction).not.toHaveBeenCalled();
      expect(m.findByIdWithBillingContext).not.toHaveBeenCalled();
      expect(m.recordDigitalPayment).not.toHaveBeenCalled();
    });

    it('a REJECTED attempt is not resurrected by a later "approved" notification', async () => {
      const m = makeService({
        attempt: makeAttempt({ status: PaymentAttemptStatus.REJECTED }),
      });

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      expect(m.$transaction).not.toHaveBeenCalled();
      expect(m.recordDigitalPayment).not.toHaveBeenCalled();
    });

    it('GOS-146: paying an attempt already closed as REJECTED is logged at ERROR level (money charged, nothing recorded) — never silent', async () => {
      const errorLog = jest.spyOn(Logger.prototype, 'error');
      errorLog.mockClear();
      const m = makeService({
        attempt: makeAttempt({
          method: PaymentMethod.RAPYD,
          status: PaymentAttemptStatus.REJECTED,
        }),
      });

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'payment_1',
      });

      expect(JSON.stringify(errorLog.mock.calls)).toContain(
        'payment_approved_for_rejected_attempt',
      );
      expect(m.recordDigitalPayment).not.toHaveBeenCalled();
    });

    it('GOS-146: a RAPYD attempt sets Engagement.paymentMethod = RAPYD and reads the details through the RAPYD adapter — never assumes Mercado Pago', async () => {
      const m = makeService({
        attempt: makeAttempt({ method: PaymentMethod.RAPYD }),
      });

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'payment_1',
      });

      expect(m.setPaymentMethodIfUnset).toHaveBeenCalledWith(
        fakeTx,
        'engagement-1',
        PaymentMethod.RAPYD,
      );
      expect(m.forMethod).toHaveBeenCalledWith(PaymentMethod.RAPYD);
    });

    it('propagates a ledger failure (the transaction rolls the approval back) and does not set the method', async () => {
      const boom = new Error('ledger down');
      const m = makeService({ recordThrows: boom });

      await expect(
        m.service.apply('attempt-1', {
          status: 'approved',
          providerPaymentId: 'ORD_1',
        }),
      ).rejects.toBe(boom);
      expect(m.setPaymentMethodIfUnset).not.toHaveBeenCalled();
    });

    it('does not fail when the Engagement payment method was already fixed (cash race) — logs a warning instead', async () => {
      const m = makeService({ setMethodCount: 0 });

      await expect(
        m.service.apply('attempt-1', {
          status: 'approved',
          providerPaymentId: 'ORD_1',
        }),
      ).resolves.toBeDefined();
      expect(m.recordDigitalPayment).toHaveBeenCalledTimes(1);
    });

    it('returns null and opens no transaction when the Engagement no longer exists', async () => {
      const m = makeService({ engagement: null });

      await expect(
        m.service.apply('attempt-1', {
          status: 'approved',
          providerPaymentId: 'ORD_1',
        }),
      ).resolves.toBeNull();
      expect(m.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('transaction details of an approved payment (best-effort — never blocks the payment)', () => {
    it('reads them from the provider with the provider id and the Engagement id (the external reference), and stores them with the status flip', async () => {
      const m = makeService();

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      expect(m.getTransactionDetails).toHaveBeenCalledTimes(1);
      expect(m.getTransactionDetails).toHaveBeenCalledWith(
        'ORD_1',
        'engagement-1',
        CountryCode.CO,
      );
      expect(m.resolveIfPending).toHaveBeenCalledWith(
        fakeTx,
        'attempt-1',
        expect.objectContaining({ details: DETAILS }),
      );
    });

    it('reads them BEFORE the transaction opens — never an HTTP call inside it', async () => {
      const order: string[] = [];
      const m = makeService();
      m.getTransactionDetails.mockImplementation(() => {
        order.push('details');
        return Promise.resolve(DETAILS);
      });
      m.$transaction.mockImplementation(
        (cb: (tx: never) => Promise<unknown>) => {
          order.push('transaction');
          return cb(fakeTx);
        },
      );

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      expect(order).toEqual(['details', 'transaction']);
    });

    it('the record not being there yet (null) still APPROVES the payment: ledger written, details left null', async () => {
      const m = makeService({ details: null });

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      expect(m.resolveIfPending).toHaveBeenCalledWith(
        fakeTx,
        'attempt-1',
        expect.objectContaining({ status: 'APPROVED', details: null }),
      );
      expect(m.recordDigitalPayment).toHaveBeenCalledTimes(1);
    });

    it('a FAILING lookup never fails the payment and never propagates: still approved and recorded', async () => {
      const m = makeService({
        detailsThrows: new Error('connect ECONNRESET secret-detail'),
      });

      await expect(
        m.service.apply('attempt-1', {
          status: 'approved',
          providerPaymentId: 'ORD_1',
        }),
      ).resolves.toBeDefined();

      expect(m.resolveIfPending).toHaveBeenCalledWith(
        fakeTx,
        'attempt-1',
        expect.objectContaining({ status: 'APPROVED', details: null }),
      );
      expect(m.recordDigitalPayment).toHaveBeenCalledTimes(1);
    });

    it('logs a failed lookup by error NAME only, never its message (which could echo request details)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      warn.mockClear();
      const m = makeService({
        detailsThrows: new TypeError('token=SECRET-VALUE in the message'),
      });

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain('payment_details_unavailable');
      expect(logged).toContain('TypeError');
      expect(logged).not.toContain('SECRET-VALUE');
    });

    it('does NOT look anything up without a provider id', async () => {
      const m = makeService();

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: null,
      });

      expect(m.getTransactionDetails).not.toHaveBeenCalled();
      expect(m.recordDigitalPayment).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'a rejected payment',
        {
          status: 'rejected' as const,
          providerPaymentId: 'ORD_1',
          rejectionReason: 'OTHER' as const,
        },
      ],
      [
        'a still-pending payment',
        { status: 'pending' as const, providerPaymentId: 'ORD_1' },
      ],
    ])('makes NO provider call for %s', async (_label, resolution) => {
      const m = makeService();

      await m.service.apply('attempt-1', resolution);

      expect(m.getTransactionDetails).not.toHaveBeenCalled();
    });

    it('makes NO provider call when the attempt was already resolved (a repeated notification costs nothing)', async () => {
      const m = makeService({
        attempt: makeAttempt({ status: PaymentAttemptStatus.APPROVED }),
      });

      await m.service.apply('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      });

      expect(m.getTransactionDetails).not.toHaveBeenCalled();
    });
  });

  describe('rejected', () => {
    it('CAS to REJECTED with the reason; NO ledger, NO paymentMethod, no billing read', async () => {
      const m = makeService();

      await m.service.apply('attempt-1', {
        status: 'rejected',
        providerPaymentId: 'ORD_1',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });

      expect(m.resolveIfPending).toHaveBeenCalledWith(fakeTx, 'attempt-1', {
        status: 'REJECTED',
        providerPaymentId: 'ORD_1',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
      expect(m.findByIdWithBillingContext).not.toHaveBeenCalled();
      expect(m.recordDigitalPayment).not.toHaveBeenCalled();
      expect(m.setPaymentMethodIfUnset).not.toHaveBeenCalled();
    });

    it('defaults a missing reason to OTHER', async () => {
      const m = makeService();

      await m.service.apply('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
      });

      expect(m.resolveIfPending).toHaveBeenCalledWith(
        fakeTx,
        'attempt-1',
        expect.objectContaining({
          rejectionReason: 'OTHER',
          providerPaymentId: null,
        }),
      );
    });
  });

  describe('pending', () => {
    it('only records the provider id on the still-open attempt — no transaction, no CAS, no ledger', async () => {
      const m = makeService();

      await m.service.apply('attempt-1', {
        status: 'pending',
        providerPaymentId: 'ORD_1',
      });

      expect(m.attachProviderPaymentIdIfPending).toHaveBeenCalledWith(
        'attempt-1',
        'ORD_1',
      );
      expect(m.$transaction).not.toHaveBeenCalled();
      expect(m.resolveIfPending).not.toHaveBeenCalled();
      expect(m.recordDigitalPayment).not.toHaveBeenCalled();
    });

    it('does nothing at all when there is no provider id to record', async () => {
      const m = makeService();

      await m.service.apply('attempt-1', {
        status: 'pending',
        providerPaymentId: null,
      });

      expect(m.attachProviderPaymentIdIfPending).not.toHaveBeenCalled();
    });
  });

  it('returns null for an unknown attempt without touching anything', async () => {
    const m = makeService({ attempt: null });

    await expect(
      m.service.apply('missing', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
      }),
    ).resolves.toBeNull();
    expect(m.$transaction).not.toHaveBeenCalled();
  });
});
