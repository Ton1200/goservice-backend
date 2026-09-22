import { Logger } from '@nestjs/common';
import { PaymentAttemptStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderPort } from '../ports/payment-provider.port';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { GetMyEngagementPaymentAttemptService } from './get-my-engagement-payment-attempt.service';

function makeAttempt(overrides?: Record<string, unknown>) {
  return {
    id: 'attempt-1',
    engagementId: 'engagement-1',
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

describe('GetMyEngagementPaymentAttemptService', () => {
  let warnLog: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => {
    warnLog.mockClear();
    errorLog.mockClear();
  });

  function makeService(options?: {
    accessError?: Error;
    latestAttempt?: Record<string, unknown> | null;
    billingContext?: Record<string, unknown> | null;
    getPayment?: jest.Mock;
    getPaymentByPaymentId?: jest.Mock;
    apply?: jest.Mock;
  }) {
    const resolveCustomerEngagement = options?.accessError
      ? jest.fn().mockRejectedValue(options.accessError)
      : jest.fn().mockResolvedValue({ id: 'engagement-1' });
    const accessService = {
      resolveCustomerEngagement,
    } as unknown as CardPaymentAccessService;

    const findByIdWithBillingContext = jest
      .fn()
      .mockResolvedValue(
        options?.billingContext === undefined
          ? { customerProfile: { country: 'CO' } }
          : options.billingContext,
      );
    const engagementsRepository = {
      findByIdWithBillingContext,
    } as unknown as EngagementsRepository;

    const findLatestByEngagementId = jest
      .fn()
      .mockResolvedValue(
        options?.latestAttempt === undefined
          ? makeAttempt()
          : options.latestAttempt,
      );
    const paymentAttemptRepository = {
      findLatestByEngagementId,
    } as unknown as PaymentAttemptRepository;

    const getPayment = options?.getPayment ?? jest.fn();
    const getPaymentByPaymentId = options?.getPaymentByPaymentId ?? jest.fn();
    const paymentProvider = {
      getPayment,
      getPaymentByPaymentId,
    } as unknown as PaymentProviderPort;

    const apply =
      options?.apply ??
      jest
        .fn()
        .mockResolvedValue(
          makeAttempt({ status: PaymentAttemptStatus.APPROVED }),
        );
    const applyService = { apply } as unknown as ApplyPaymentResultService;

    const service = new GetMyEngagementPaymentAttemptService(
      accessService,
      engagementsRepository,
      paymentAttemptRepository,
      paymentProvider,
      applyService,
    );
    return {
      service,
      resolveCustomerEngagement,
      findLatestByEngagementId,
      getPayment,
      getPaymentByPaymentId,
      apply,
    };
  }

  it('an owner check failure surfaces the anti-enumeration engagementNotFound()', async () => {
    const m = makeService({ accessError: engagementNotFound() });

    await expect(
      m.service.getMyEngagementPaymentAttempt('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('returns null when the Engagement has no attempt yet', async () => {
    const m = makeService({ latestAttempt: null });

    await expect(
      m.service.getMyEngagementPaymentAttempt('user-1', 'engagement-1'),
    ).resolves.toBeNull();
  });

  it.each([[PaymentAttemptStatus.APPROVED], [PaymentAttemptStatus.REJECTED]])(
    'returns an already-resolved (%s) attempt as-is, without re-reading the provider',
    async (status) => {
      const m = makeService({ latestAttempt: makeAttempt({ status }) });

      const result = await m.service.getMyEngagementPaymentAttempt(
        'user-1',
        'engagement-1',
      );

      expect(result).toMatchObject({ status });
      expect(m.getPayment).not.toHaveBeenCalled();
      expect(m.getPaymentByPaymentId).not.toHaveBeenCalled();
      expect(m.apply).not.toHaveBeenCalled();
    },
  );

  it('returns a PENDING attempt with no providerPaymentId as-is — nothing to re-read yet (documented gap)', async () => {
    const m = makeService({
      latestAttempt: makeAttempt({ providerPaymentId: null }),
    });

    const result = await m.service.getMyEngagementPaymentAttempt(
      'user-1',
      'engagement-1',
    );

    expect(result).toMatchObject({ status: PaymentAttemptStatus.PENDING });
    expect(m.getPayment).not.toHaveBeenCalled();
    expect(m.getPaymentByPaymentId).not.toHaveBeenCalled();
  });

  describe('opportunistic reconciliation of a PENDING attempt that already has a providerPaymentId', () => {
    it('re-reads a WALLET attempt (numeric id) via getPaymentByPaymentId, never getPayment, and applies the result', async () => {
      const m = makeService({
        latestAttempt: makeAttempt({ providerPaymentId: '178687128941' }),
        getPaymentByPaymentId: jest.fn().mockResolvedValue({
          providerPaymentId: '178687128941',
          status: 'approved',
          externalReference: 'engagement-1',
          amount: 50000,
          currency: 'COP',
        }),
      });

      const result = await m.service.getMyEngagementPaymentAttempt(
        'user-1',
        'engagement-1',
      );

      expect(m.getPaymentByPaymentId).toHaveBeenCalledWith(
        '178687128941',
        'CO',
      );
      expect(m.getPayment).not.toHaveBeenCalled();
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'approved',
        providerPaymentId: '178687128941',
        rejectionReason: undefined,
      });
      expect(result).toMatchObject({ status: PaymentAttemptStatus.APPROVED });
    });

    it('re-reads a CARD attempt (order id) via getPayment, never getPaymentByPaymentId', async () => {
      const m = makeService({
        latestAttempt: makeAttempt({ providerPaymentId: 'ORD_1' }),
        getPayment: jest.fn().mockResolvedValue({
          providerPaymentId: 'ORD_1',
          status: 'approved',
          externalReference: 'engagement-1',
          amount: 50000,
          currency: 'COP',
        }),
      });

      await m.service.getMyEngagementPaymentAttempt('user-1', 'engagement-1');

      expect(m.getPayment).toHaveBeenCalledWith('ORD_1', 'CO');
      expect(m.getPaymentByPaymentId).not.toHaveBeenCalled();
    });

    it('never approves an amount/currency mismatch — same safety guard as the webhook', async () => {
      const m = makeService({
        latestAttempt: makeAttempt({ providerPaymentId: '178687128941' }),
        getPaymentByPaymentId: jest.fn().mockResolvedValue({
          providerPaymentId: '178687128941',
          status: 'approved',
          externalReference: 'engagement-1',
          amount: 1,
          currency: 'COP',
        }),
      });

      const result = await m.service.getMyEngagementPaymentAttempt(
        'user-1',
        'engagement-1',
      );

      expect(m.apply).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: PaymentAttemptStatus.PENDING });
      expect(JSON.stringify(errorLog.mock.calls)).toContain(
        'my_engagement_payment_attempt_amount_mismatch',
      );
    });

    it('returns the still-PENDING attempt when the provider has no record yet', async () => {
      const m = makeService({
        latestAttempt: makeAttempt({ providerPaymentId: '178687128941' }),
        getPaymentByPaymentId: jest.fn().mockResolvedValue(null),
      });

      const result = await m.service.getMyEngagementPaymentAttempt(
        'user-1',
        'engagement-1',
      );

      expect(m.apply).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: PaymentAttemptStatus.PENDING });
    });

    it('NEVER fails or throws when the provider is unreachable — swallows and returns what is already persisted', async () => {
      const m = makeService({
        latestAttempt: makeAttempt({ providerPaymentId: '178687128941' }),
        getPaymentByPaymentId: jest
          .fn()
          .mockRejectedValue(new Error('ECONNRESET')),
      });

      const result = await m.service.getMyEngagementPaymentAttempt(
        'user-1',
        'engagement-1',
      );

      expect(result).toMatchObject({ status: PaymentAttemptStatus.PENDING });
      expect(JSON.stringify(warnLog.mock.calls)).toContain(
        'my_engagement_payment_attempt_reconciliation_failed',
      );
    });

    it('returns the still-PENDING attempt when the billing context is gone (a hard delete raced this call)', async () => {
      const m = makeService({
        latestAttempt: makeAttempt({ providerPaymentId: '178687128941' }),
        billingContext: null,
      });

      const result = await m.service.getMyEngagementPaymentAttempt(
        'user-1',
        'engagement-1',
      );

      expect(result).toMatchObject({ status: PaymentAttemptStatus.PENDING });
      expect(m.getPaymentByPaymentId).not.toHaveBeenCalled();
    });
  });
});
