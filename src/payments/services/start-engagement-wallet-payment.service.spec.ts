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
} from '../ports/payment-provider.port';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { StartEngagementWalletPaymentService } from './start-engagement-wallet-payment.service';

const INPUT = { engagementId: 'engagement-1' };

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

describe('StartEngagementWalletPaymentService', () => {
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
    createWalletPreference?: jest.Mock;
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

    const createWalletPreference =
      options?.createWalletPreference ??
      jest.fn().mockResolvedValue({
        preferenceId: '1534142261-pref-1',
        redirectUrl: 'https://sandbox.mercadopago.com/checkout/v1/redirect',
      });
    const paymentProvider = {
      createWalletPreference,
    };

    const apply =
      options?.apply ??
      jest
        .fn()
        .mockResolvedValue(
          makeAttempt({ status: PaymentAttemptStatus.REJECTED }),
        );
    const applyService = { apply } as unknown as ApplyPaymentResultService;

    const service = new StartEngagementWalletPaymentService(
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
      createWalletPreference,
      apply,
    };
  }

  describe('happy path', () => {
    it('creates the PENDING attempt (installments: 1), starts the preference with server-derived values, and returns it UNRESOLVED (never applies)', async () => {
      const m = makeService();

      const result = await m.service.startEngagementWalletPayment(
        'user-1',
        INPUT,
      );

      expect(m.createPending).toHaveBeenCalledWith({
        engagementId: 'engagement-1',
        method: PaymentMethod.MERCADOPAGO,
        amount: 50000,
        currency: 'COP',
        installments: 1,
      });
      expect(m.createWalletPreference).toHaveBeenCalledWith({
        amount: 50000,
        currency: 'COP',
        country: 'CO',
        description: 'GoService — Engagement engagement-1',
        externalReference: 'engagement-1',
        payerEmail: 'buyer@example.com',
      });
      // A wallet checkout NEVER resolves synchronously — unlike the card
      // flow, `apply` is never called on the happy path.
      expect(m.apply).not.toHaveBeenCalled();
      expect(result.redirectUrl).toBe(
        'https://sandbox.mercadopago.com/checkout/v1/redirect',
      );
      expect(result.attempt).toMatchObject({
        id: 'attempt-1',
        status: PaymentAttemptStatus.PENDING,
        providerPaymentId: null,
      });
    });

    it('charges negotiatedPrice when there is one, else the Quote price', async () => {
      const negotiated = makeService({
        quote: { price: 60000, negotiatedPrice: 45000 },
      });
      await negotiated.service.startEngagementWalletPayment('user-1', INPUT);
      expect(negotiated.createPending).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 45000 }),
      );

      const plain = makeService({
        quote: { price: 60000, negotiatedPrice: null },
      });
      await plain.service.startEngagementWalletPayment('user-1', INPUT);
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
        await m.service.startEngagementWalletPayment('user-1', INPUT);
        expect(m.createPending).toHaveBeenCalledWith(
          expect.objectContaining({ currency }),
        );
        expect(m.createWalletPreference).toHaveBeenCalledWith(
          expect.objectContaining({ currency, country }),
        );
      },
    );

    it('never persists the preference id anywhere on the attempt — it is logged for traceability only', async () => {
      const m = makeService();
      const result = await m.service.startEngagementWalletPayment(
        'user-1',
        INPUT,
      );
      expect(result.attempt.providerPaymentId).toBeNull();
    });
  });

  describe('preference-creation failure — DEFINITIVE, unlike a card charge timeout', () => {
    it('an unconfigured provider REJECTS the attempt and throws PAYMENT_PROVIDER_MISCONFIGURED', async () => {
      const m = makeService({
        createWalletPreference: jest
          .fn()
          .mockRejectedValue(new PaymentProviderNotConfiguredError('token')),
      });

      await expect(
        m.service.startEngagementWalletPayment('user-1', INPUT),
      ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_MISCONFIGURED' });
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'PROVIDER_ERROR',
      });
    });

    it.each([
      ['a provider outage', new PaymentProviderUnavailableError('HTTP 503')],
      ['an unexpected error', new Error('boom')],
    ])(
      '%s ALSO rejects the attempt (never left PENDING — no preference means no charge could ever have happened) and throws PAYMENT_PROVIDER_UNAVAILABLE',
      async (_label, error) => {
        const m = makeService({
          createWalletPreference: jest.fn().mockRejectedValue(error),
        });

        await expect(
          m.service.startEngagementWalletPayment('user-1', INPUT),
        ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
        expect(m.apply).toHaveBeenCalledWith('attempt-1', {
          status: 'rejected',
          providerPaymentId: null,
          rejectionReason: 'PROVIDER_ERROR',
        });
      },
    );
  });

  describe('no double payment', () => {
    it('maps the unique-index violation (P2002) to WALLET_PAYMENT_ALREADY_IN_PROGRESS and never calls the provider', async () => {
      const m = makeService({ createPendingError: p2002() });

      await expect(
        m.service.startEngagementWalletPayment('user-1', INPUT),
      ).rejects.toMatchObject({ code: 'WALLET_PAYMENT_ALREADY_IN_PROGRESS' });
      expect(m.createWalletPreference).not.toHaveBeenCalled();
    });

    it('maps the SAME P2002 to PAYMENT_METHOD_CONFLICT when a fresh read shows the active slot is held by a CASH attempt', async () => {
      const m = makeService({
        createPendingError: p2002(),
        activeAttempt: makeAttempt({ method: PaymentMethod.CASH }),
      });

      await expect(
        m.service.startEngagementWalletPayment('user-1', INPUT),
      ).rejects.toMatchObject({ code: 'PAYMENT_METHOD_CONFLICT' });
      expect(m.createWalletPreference).not.toHaveBeenCalled();
      expect(m.findActiveByEngagementId).toHaveBeenCalledWith('engagement-1');
    });

    it('rethrows any OTHER database error untouched', async () => {
      const boom = new Error('db down');
      const m = makeService({ createPendingError: boom });

      await expect(
        m.service.startEngagementWalletPayment('user-1', INPUT),
      ).rejects.toBe(boom);
      expect(m.createWalletPreference).not.toHaveBeenCalled();
    });
  });

  describe('preconditions (nothing is created and the provider is never called)', () => {
    it('an owner check failure surfaces the anti-enumeration engagementNotFound()', async () => {
      const m = makeService({ accessError: engagementNotFound() });

      await expect(
        m.service.startEngagementWalletPayment('user-1', INPUT),
      ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
      expect(m.createPending).not.toHaveBeenCalled();
      expect(m.createWalletPreference).not.toHaveBeenCalled();
    });

    it.each([
      [EngagementStatus.IN_PROGRESS],
      [EngagementStatus.PENDING_CUSTOMER_CONFIRMATION],
      [EngagementStatus.COMPLETED],
    ])('allows %s', async (status) => {
      const m = makeService({ engagement: makeEngagement({ status }) });
      await expect(
        m.service.startEngagementWalletPayment('user-1', INPUT),
      ).resolves.toBeDefined();
    });

    it.each([[EngagementStatus.ACCEPTED], [EngagementStatus.CANCELLED]])(
      'rejects %s with ENGAGEMENT_NOT_PAYABLE_BY_WALLET',
      async (status) => {
        const m = makeService({ engagement: makeEngagement({ status }) });

        await expect(
          m.service.startEngagementWalletPayment('user-1', INPUT),
        ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_PAYABLE_BY_WALLET' });
        expect(m.createPending).not.toHaveBeenCalled();
        expect(m.createWalletPreference).not.toHaveBeenCalled();
      },
    );

    it('rejects an Engagement whose payment method is already fixed to CASH', async () => {
      const m = makeService({
        engagement: makeEngagement({ paymentMethod: PaymentMethod.CASH }),
      });

      await expect(
        m.service.startEngagementWalletPayment('user-1', INPUT),
      ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_PAYABLE_BY_WALLET' });
      expect(m.createWalletPreference).not.toHaveBeenCalled();
    });

    it('still allows an Engagement already set to MERCADOPAGO (e.g. a retry after a REJECTED card attempt)', async () => {
      const m = makeService({
        engagement: makeEngagement({
          paymentMethod: PaymentMethod.MERCADOPAGO,
        }),
      });
      await expect(
        m.service.startEngagementWalletPayment('user-1', INPUT),
      ).resolves.toBeDefined();
    });
  });
});
