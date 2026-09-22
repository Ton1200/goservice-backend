import { Logger } from '@nestjs/common';
import { PaymentAttemptStatus, PaymentMethod } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { GetMyEngagementPaymentAttemptService } from './get-my-engagement-payment-attempt.service';
import {
  AttemptProviderState,
  ReadAttemptProviderStateService,
} from './read-attempt-provider-state.service';

function makeAttempt(overrides?: Record<string, unknown>) {
  return {
    id: 'attempt-1',
    engagementId: 'engagement-1',
    method: PaymentMethod.MERCADOPAGO,
    status: PaymentAttemptStatus.PENDING,
    providerPaymentId: null,
    providerCheckoutId: null,
    amount: 50000,
    currency: 'COP',
    installments: 1,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeState(
  overrides?: Partial<AttemptProviderState>,
): AttemptProviderState {
  return {
    status: 'approved',
    providerPaymentId: '178687128941',
    externalReference: 'engagement-1',
    amount: 50000,
    currency: 'COP',
    paymentCreated: true,
    open: false,
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
    read?: jest.Mock;
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

    const read = options?.read ?? jest.fn();
    const readService = { read } as unknown as ReadAttemptProviderStateService;

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
      readService,
      applyService,
    );
    return {
      service,
      resolveCustomerEngagement,
      findLatestByEngagementId,
      read,
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
      expect(m.read).not.toHaveBeenCalled();
      expect(m.apply).not.toHaveBeenCalled();
    },
  );

  it('returns a PENDING attempt with neither a providerPaymentId nor a providerCheckoutId as-is — nothing to re-read yet (documented gap)', async () => {
    const m = makeService({
      latestAttempt: makeAttempt({
        providerPaymentId: null,
        providerCheckoutId: null,
      }),
    });

    const result = await m.service.getMyEngagementPaymentAttempt(
      'user-1',
      'engagement-1',
    );

    expect(result).toMatchObject({ status: PaymentAttemptStatus.PENDING });
    expect(m.read).not.toHaveBeenCalled();
  });

  describe('opportunistic reconciliation of a PENDING attempt the provider can be asked about', () => {
    it('re-reads a Mercado Pago attempt that has a providerPaymentId and applies the result', async () => {
      const attempt = makeAttempt({ providerPaymentId: '178687128941' });
      const m = makeService({
        latestAttempt: attempt,
        read: jest.fn().mockResolvedValue(makeState()),
      });

      const result = await m.service.getMyEngagementPaymentAttempt(
        'user-1',
        'engagement-1',
      );

      // The reader dispatches by the attempt's method; the country is the
      // Engagement's own, never anything client-supplied.
      expect(m.read).toHaveBeenCalledWith(attempt, 'CO');
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'approved',
        providerPaymentId: '178687128941',
        rejectionReason: undefined,
      });
      expect(result).toMatchObject({ status: PaymentAttemptStatus.APPROVED });
    });

    it('reconciles a Rapyd attempt that has ONLY a providerCheckoutId (no webhook, no payment id yet) and records the payment id the checkout reveals', async () => {
      const attempt = makeAttempt({
        method: PaymentMethod.RAPYD,
        providerPaymentId: null,
        providerCheckoutId: 'checkout_1',
      });
      const m = makeService({
        latestAttempt: attempt,
        read: jest
          .fn()
          .mockResolvedValue(makeState({ providerPaymentId: 'payment_1' })),
      });

      const result = await m.service.getMyEngagementPaymentAttempt(
        'user-1',
        'engagement-1',
      );

      expect(m.read).toHaveBeenCalledWith(attempt, 'CO');
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'approved',
        providerPaymentId: 'payment_1',
        rejectionReason: undefined,
      });
      expect(result).toMatchObject({ status: PaymentAttemptStatus.APPROVED });
    });

    it('never approves an amount/currency mismatch — same safety guard as the webhook', async () => {
      const m = makeService({
        latestAttempt: makeAttempt({ providerPaymentId: '178687128941' }),
        read: jest.fn().mockResolvedValue(makeState({ amount: 1 })),
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
        read: jest.fn().mockResolvedValue(null),
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
        read: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
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
      expect(m.read).not.toHaveBeenCalled();
    });
  });
});
