import { Logger } from '@nestjs/common';
import {
  PaymentAttemptStatus,
  EngagementStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { UsersRepository } from '../../users/users.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { makeRegistryFixture } from '../payment-provider-registry.fixtures';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { PayEngagementWithCardService } from './pay-engagement-with-card.service';

const CARD_TOKEN = 'tok_super_secret_card_token';

const INPUT = {
  engagementId: 'engagement-1',
  cardToken: CARD_TOKEN,
  paymentMethodId: 'visa',
  installments: 1,
};

function makeEngagement(overrides?: Record<string, unknown>) {
  return {
    id: 'engagement-1',
    status: EngagementStatus.IN_PROGRESS,
    paymentMethod: null,
    customerProfileId: 'customer-1',
    professionalProfileId: 'professional-1',
    ...overrides,
  };
}

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

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('PayEngagementWithCardService', () => {
  let errorLog: jest.SpyInstance;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => errorLog.mockClear());

  function makeService(options?: {
    engagement?: ReturnType<typeof makeEngagement>;
    accessError?: Error;
    quote?: { price: number; negotiatedPrice: number | null };
    country?: 'AR' | 'CO';
    createPendingError?: Error;
    chargeCard?: jest.Mock;
    apply?: jest.Mock;
    activeAttempt?: Record<string, unknown> | null;
  }) {
    const resolveCustomerEngagement = options?.accessError
      ? jest.fn().mockRejectedValue(options.accessError)
      : jest.fn().mockResolvedValue(options?.engagement ?? makeEngagement());
    const accessService = {
      resolveCustomerEngagement,
    } as unknown as CardPaymentAccessService;

    const findByIdWithBillingContext = jest.fn().mockResolvedValue({
      quote: options?.quote ?? { price: 50000, negotiatedPrice: null },
      customerProfile: { country: options?.country ?? 'CO' },
    });
    const engagementsRepository = {
      findByIdWithBillingContext,
    } as unknown as EngagementsRepository;

    const usersRepository = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'buyer@example.com' }),
    } as unknown as UsersRepository;

    const createPending = options?.createPendingError
      ? jest.fn().mockRejectedValue(options.createPendingError)
      : jest.fn().mockResolvedValue(makeAttempt());
    // Default: the slot is held by ANOTHER card attempt — the common case.
    const findActiveByEngagementId = jest
      .fn()
      .mockResolvedValue(
        options?.activeAttempt === undefined
          ? makeAttempt({ method: PaymentMethod.MERCADOPAGO })
          : options.activeAttempt,
      );
    const paymentAttemptRepository = {
      createPending,
      findActiveByEngagementId,
    } as unknown as PaymentAttemptRepository;

    const chargeCard =
      options?.chargeCard ??
      jest
        .fn()
        .mockResolvedValue({ providerPaymentId: 'ORD_1', status: 'approved' });
    const paymentProvider = { chargeCard };

    const apply =
      options?.apply ??
      jest
        .fn()
        .mockResolvedValue(
          makeAttempt({ status: PaymentAttemptStatus.APPROVED }),
        );
    const applyService = { apply } as unknown as ApplyPaymentResultService;

    const service = new PayEngagementWithCardService(
      accessService,
      engagementsRepository,
      usersRepository,
      paymentAttemptRepository,
      makeRegistryFixture(paymentProvider),
      applyService,
    );
    return {
      service,
      resolveCustomerEngagement,
      createPending,
      findActiveByEngagementId,
      chargeCard,
      apply,
    };
  }

  describe('happy path', () => {
    it('creates the PENDING attempt, charges through the port with server-derived values, then applies the result', async () => {
      const m = makeService();

      const result = await m.service.payEngagementWithCard('user-1', INPUT);

      expect(m.createPending).toHaveBeenCalledWith({
        engagementId: 'engagement-1',
        method: PaymentMethod.MERCADOPAGO,
        amount: 50000,
        currency: 'COP',
        installments: 1,
      });
      expect(m.chargeCard).toHaveBeenCalledWith({
        cardToken: CARD_TOKEN,
        amount: 50000,
        currency: 'COP',
        country: 'CO',
        description: 'GoService — Engagement engagement-1',
        externalReference: 'engagement-1', // Engagement.id, for correlating notifications
        paymentMethodId: 'visa',
        installments: 1,
        payerEmail: 'buyer@example.com', // from the User, never from the client
        idempotencyKey: 'attempt-1', // the attempt id
      });
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'approved',
        providerPaymentId: 'ORD_1',
        rejectionReason: undefined,
      });
      expect(result.status).toBe(PaymentAttemptStatus.APPROVED);
    });

    it('charges negotiatedPrice when there is one, else the Quote price', async () => {
      const negotiated = makeService({
        quote: { price: 60000, negotiatedPrice: 45000 },
      });
      await negotiated.service.payEngagementWithCard('user-1', INPUT);
      expect(negotiated.createPending).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 45000 }),
      );

      const plain = makeService({
        quote: { price: 60000, negotiatedPrice: null },
      });
      await plain.service.payEngagementWithCard('user-1', INPUT);
      expect(plain.createPending).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 60000 }),
      );
    });

    it.each([
      ['AR', 'ARS'],
      ['CO', 'COP'],
    ] as const)(
      'derives the currency from the Customer country (%s -> %s)',
      async (country, currency) => {
        const m = makeService({ country });
        await m.service.payEngagementWithCard('user-1', INPUT);
        expect(m.createPending).toHaveBeenCalledWith(
          expect.objectContaining({ currency }),
        );
        expect(m.chargeCard).toHaveBeenCalledWith(
          expect.objectContaining({ currency }),
        );
      },
    );

    it('passes the requested installments through to attempt and provider', async () => {
      const m = makeService();
      await m.service.payEngagementWithCard('user-1', {
        ...INPUT,
        installments: 6,
      });
      expect(m.createPending).toHaveBeenCalledWith(
        expect.objectContaining({ installments: 6 }),
      );
      expect(m.chargeCard).toHaveBeenCalledWith(
        expect.objectContaining({ installments: 6 }),
      );
    });
  });

  describe('outcomes', () => {
    it('a REJECTED result is a normal return value, not an exception', async () => {
      const rejected = makeAttempt({
        status: PaymentAttemptStatus.REJECTED,
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
      const m = makeService({
        chargeCard: jest.fn().mockResolvedValue({
          providerPaymentId: 'ORD_2',
          status: 'rejected',
          rejectionReason: 'INSUFFICIENT_FUNDS',
        }),
        apply: jest.fn().mockResolvedValue(rejected),
      });

      const result = await m.service.payEngagementWithCard('user-1', INPUT);

      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: 'ORD_2',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
      expect(result.status).toBe(PaymentAttemptStatus.REJECTED);
    });

    it('a PENDING result leaves the attempt PENDING and returns it', async () => {
      const m = makeService({
        chargeCard: jest
          .fn()
          .mockResolvedValue({ providerPaymentId: 'ORD_3', status: 'pending' }),
        apply: jest
          .fn()
          .mockResolvedValue(makeAttempt({ providerPaymentId: 'ORD_3' })),
      });

      const result = await m.service.payEngagementWithCard('user-1', INPUT);

      expect(m.apply).toHaveBeenCalledWith(
        'attempt-1',
        expect.objectContaining({ status: 'pending' }),
      );
      expect(result.status).toBe(PaymentAttemptStatus.PENDING);
    });

    it('a definitive "no charge created" from the provider resolves the attempt REJECTED with that reason', async () => {
      const m = makeService({
        chargeCard: jest
          .fn()
          .mockRejectedValue(
            new PaymentRequestRejectedError('INVALID_CARD_DATA'),
          ),
      });

      await m.service.payEngagementWithCard('user-1', INPUT);

      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'INVALID_CARD_DATA',
      });
    });

    it('an unconfigured provider REJECTS the attempt (so it cannot block a retry) and throws PAYMENT_PROVIDER_MISCONFIGURED', async () => {
      const m = makeService({
        chargeCard: jest
          .fn()
          .mockRejectedValue(new PaymentProviderNotConfiguredError('token')),
      });

      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).rejects.toMatchObject({
        code: 'PAYMENT_PROVIDER_MISCONFIGURED',
      });
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'PROVIDER_ERROR',
      });
    });

    it.each([
      ['a provider outage', new PaymentProviderUnavailableError('HTTP 503')],
      [
        'an unexpected error after the request may have been sent',
        new Error('boom'),
      ],
    ])(
      '%s: leaves the attempt PENDING (unknown outcome — never assumed rejected) and throws PAYMENT_PROVIDER_UNAVAILABLE',
      async (_label, error) => {
        const m = makeService({
          chargeCard: jest.fn().mockRejectedValue(error),
        });

        await expect(
          m.service.payEngagementWithCard('user-1', INPUT),
        ).rejects.toMatchObject({
          code: 'PAYMENT_PROVIDER_UNAVAILABLE',
        });
        expect(m.apply).not.toHaveBeenCalled();
      },
    );

    it('never writes the card token to a log line, even on the failure path', async () => {
      const m = makeService({
        chargeCard: jest
          .fn()
          .mockRejectedValue(new PaymentProviderUnavailableError('HTTP 503')),
      });

      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).rejects.toBeDefined();

      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(CARD_TOKEN);
    });

    it('propagates a failure to record an approved charge (the attempt stays PENDING for the notification to resolve)', async () => {
      const boom = new Error('ledger misconfigured');
      const m = makeService({ apply: jest.fn().mockRejectedValue(boom) });

      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).rejects.toBe(boom);
      expect(JSON.stringify(errorLog.mock.calls)).toContain(
        'card_payment_provider_answered_but_not_recorded',
      );
    });
  });

  describe('no double charge', () => {
    it('maps the unique-index violation (P2002) to CARD_PAYMENT_ALREADY_IN_PROGRESS and never calls the provider', async () => {
      const m = makeService({ createPendingError: p2002() });

      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).rejects.toMatchObject({
        code: 'CARD_PAYMENT_ALREADY_IN_PROGRESS',
      });
      expect(m.chargeCard).not.toHaveBeenCalled();
    });

    it('maps the SAME P2002 to PAYMENT_METHOD_CONFLICT when a fresh read shows the active slot is held by a CASH attempt — the race the in-memory Engagement read could not see', async () => {
      const m = makeService({
        createPendingError: p2002(),
        activeAttempt: makeAttempt({ method: PaymentMethod.CASH }),
      });

      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).rejects.toMatchObject({ code: 'PAYMENT_METHOD_CONFLICT' });
      expect(m.chargeCard).not.toHaveBeenCalled();
      expect(m.findActiveByEngagementId).toHaveBeenCalledWith('engagement-1');
    });

    it('rethrows any OTHER database error untouched', async () => {
      const boom = new Error('db down');
      const m = makeService({ createPendingError: boom });

      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).rejects.toBe(boom);
      expect(m.chargeCard).not.toHaveBeenCalled();
    });
  });

  describe('preconditions (nothing is created and the provider is never called)', () => {
    it('an owner check failure surfaces the anti-enumeration engagementNotFound()', async () => {
      const m = makeService({ accessError: engagementNotFound() });

      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_FOUND',
      });
      expect(m.createPending).not.toHaveBeenCalled();
      expect(m.chargeCard).not.toHaveBeenCalled();
    });

    it.each([
      [EngagementStatus.IN_PROGRESS],
      [EngagementStatus.PENDING_CUSTOMER_CONFIRMATION],
      [EngagementStatus.COMPLETED],
    ])('allows %s', async (status) => {
      const m = makeService({ engagement: makeEngagement({ status }) });
      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).resolves.toBeDefined();
    });

    it.each([[EngagementStatus.ACCEPTED], [EngagementStatus.CANCELLED]])(
      'rejects %s with ENGAGEMENT_NOT_PAYABLE_BY_CARD',
      async (status) => {
        const m = makeService({ engagement: makeEngagement({ status }) });

        await expect(
          m.service.payEngagementWithCard('user-1', INPUT),
        ).rejects.toMatchObject({
          code: 'ENGAGEMENT_NOT_PAYABLE_BY_CARD',
        });
        expect(m.createPending).not.toHaveBeenCalled();
        expect(m.chargeCard).not.toHaveBeenCalled();
      },
    );

    it('rejects an Engagement whose payment method is already fixed to CASH', async () => {
      const m = makeService({
        engagement: makeEngagement({ paymentMethod: PaymentMethod.CASH }),
      });

      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_PAYABLE_BY_CARD',
      });
      expect(m.chargeCard).not.toHaveBeenCalled();
    });

    it('still allows an Engagement already set to MERCADOPAGO (a retry after a REJECTED attempt)', async () => {
      const m = makeService({
        engagement: makeEngagement({
          paymentMethod: PaymentMethod.MERCADOPAGO,
        }),
      });
      await expect(
        m.service.payEngagementWithCard('user-1', INPUT),
      ).resolves.toBeDefined();
    });
  });

  describe('input validation (before anything else happens)', () => {
    it.each([
      ['a blank card token', { cardToken: '   ' }],
      ['an empty payment method id', { paymentMethodId: '' }],
      [
        'a payment method id with illegal characters',
        { paymentMethodId: 'visa/../x' },
      ],
      ['zero installments', { installments: 0 }],
      ['negative installments', { installments: -1 }],
      ['fractional installments', { installments: 1.5 }],
    ])(
      'rejects %s with INVALID_CARD_PAYMENT_INPUT',
      async (_label, override) => {
        const m = makeService();

        await expect(
          m.service.payEngagementWithCard('user-1', { ...INPUT, ...override }),
        ).rejects.toMatchObject({ code: 'INVALID_CARD_PAYMENT_INPUT' });
        expect(m.resolveCustomerEngagement).not.toHaveBeenCalled();
        expect(m.createPending).not.toHaveBeenCalled();
      },
    );
  });
});
