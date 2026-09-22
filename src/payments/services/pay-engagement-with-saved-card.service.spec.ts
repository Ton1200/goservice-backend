import { Logger } from '@nestjs/common';
import {
  EngagementStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
  ProviderPaymentSnapshot,
} from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { PayEngagementWithSavedCardService } from './pay-engagement-with-saved-card.service';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';

function makeAttempt(overrides?: Record<string, unknown>) {
  return {
    id: 'attempt-1',
    engagementId: 'engagement-1',
    method: PaymentMethod.RAPYD,
    status: PaymentAttemptStatus.PENDING,
    providerPaymentId: null,
    providerCheckoutId: null,
    amount: 50000,
    currency: 'ARS',
    installments: 1,
    ...overrides,
  };
}

function makeCharge(
  overrides?: Partial<ProviderPaymentSnapshot>,
): ProviderPaymentSnapshot {
  return {
    providerPaymentId: 'payment_1',
    status: 'approved',
    externalReference: 'engagement-1',
    amount: 50000,
    currency: 'ARS',
    ...overrides,
  };
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('PayEngagementWithSavedCardService', () => {
  let errorLog: jest.SpyInstance;
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => errorLog.mockClear());

  function makeService(options?: {
    accessError?: Error;
    engagement?: Record<string, unknown>;
    profile?: Record<string, unknown> | null;
    card?: Record<string, unknown> | null;
    link?: { providerCustomerId: string; environment: string } | null;
    linkError?: Error;
    createPendingError?: Error;
    active?: Record<string, unknown> | null;
    charge?: jest.Mock;
  }) {
    const accessService = {
      resolveCustomerEngagement: options?.accessError
        ? jest.fn().mockRejectedValue(options.accessError)
        : jest.fn().mockResolvedValue({
            id: 'engagement-1',
            status: EngagementStatus.IN_PROGRESS,
            paymentMethod: null,
            ...options?.engagement,
          }),
    } as unknown as CardPaymentAccessService;
    const engagementsRepository = {
      findByIdWithBillingContext: jest.fn().mockResolvedValue({
        quote: { price: 60000, negotiatedPrice: 50000 },
        customerProfile: { country: 'AR' },
      }),
    } as unknown as EngagementsRepository;
    const profilesRepository = {
      findCustomerProfileByUserId: jest
        .fn()
        .mockResolvedValue(
          options?.profile === undefined
            ? { id: 'profile-1' }
            : options.profile,
        ),
    } as unknown as ProfilesRepository;
    const findCardOfCustomer = jest.fn().mockResolvedValue(
      options?.card === undefined
        ? {
            id: 'saved-1',
            method: PaymentMethod.RAPYD,
            environment: 'sandbox',
            providerCardId: 'card_1',
          }
        : options.card,
    );
    const savedCardRepository = {
      findCardOfCustomer,
    } as unknown as SavedCardRepository;
    const find = options?.linkError
      ? jest.fn().mockRejectedValue(options.linkError)
      : jest
          .fn()
          .mockResolvedValue(
            options?.link === undefined
              ? { providerCustomerId: 'cus_1', environment: 'sandbox' }
              : options.link,
          );
    const customerService = {
      find,
    } as unknown as RapydSavedCardsCustomerService;

    const createPending = options?.createPendingError
      ? jest.fn().mockRejectedValue(options.createPendingError)
      : jest.fn().mockResolvedValue(makeAttempt());
    const attachProviderPaymentIdIfPending = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    const findById = jest
      .fn()
      .mockResolvedValue(makeAttempt({ providerPaymentId: 'payment_1' }));
    const findActiveByEngagementId = jest
      .fn()
      .mockResolvedValue(options?.active ?? null);
    const paymentAttemptRepository = {
      createPending,
      attachProviderPaymentIdIfPending,
      findById,
      findActiveByEngagementId,
    } as unknown as PaymentAttemptRepository;

    const chargeSavedCard =
      options?.charge ?? jest.fn().mockResolvedValue(makeCharge());
    const savedCards = jest.fn().mockReturnValue({ chargeSavedCard });
    const registry = { savedCards } as unknown as PaymentProviderRegistry;

    const apply = jest.fn().mockResolvedValue(makeAttempt());
    const applyService = { apply } as unknown as ApplyPaymentResultService;

    const service = new PayEngagementWithSavedCardService(
      accessService,
      engagementsRepository,
      profilesRepository,
      savedCardRepository,
      customerService,
      paymentAttemptRepository,
      registry,
      applyService,
    );
    return {
      service,
      findCardOfCustomer,
      createPending,
      attachProviderPaymentIdIfPending,
      chargeSavedCard,
      apply,
      savedCards,
    };
  }

  const pay = (m: ReturnType<typeof makeService>) =>
    m.service.payEngagementWithSavedCard('user-1', {
      engagementId: 'engagement-1',
      savedCardId: 'saved-1',
    });

  it('charges the stored token with SERVER-derived amount/currency, the attempt id as idempotency key and the Rapyd customer — then applies the approval through the shared service', async () => {
    const m = makeService();

    await pay(m);

    expect(m.createPending).toHaveBeenCalledWith({
      engagementId: 'engagement-1',
      method: PaymentMethod.RAPYD,
      amount: 50000, // negotiatedPrice ?? price
      currency: 'ARS',
      installments: 1,
    });
    expect(m.chargeSavedCard).toHaveBeenCalledWith({
      customerId: 'cus_1',
      providerCardId: 'card_1',
      amount: 50000,
      currency: 'ARS',
      description: 'GoService — Engagement engagement-1',
      externalReference: 'engagement-1',
      idempotencyKey: 'attempt-1',
    });
    expect(m.createPending.mock.invocationCallOrder[0]).toBeLessThan(
      m.chargeSavedCard.mock.invocationCallOrder[0],
    );
    expect(m.apply).toHaveBeenCalledWith('attempt-1', {
      status: 'approved',
      providerPaymentId: 'payment_1',
      rejectionReason: undefined,
    });
  });

  it('a declined card resolves the attempt REJECTED with the domain reason', async () => {
    const m = makeService({
      charge: jest.fn().mockResolvedValue(
        makeCharge({
          status: 'rejected',
          rejectionReason: 'INSUFFICIENT_FUNDS',
        }),
      ),
    });

    await pay(m);

    expect(m.apply).toHaveBeenCalledWith('attempt-1', {
      status: 'rejected',
      providerPaymentId: 'payment_1',
      rejectionReason: 'INSUFFICIENT_FUNDS',
    });
  });

  it('3D Secure demanded by the issuer: the attempt is REJECTED with AUTHENTICATION_REQUIRED (nothing charged) so the client can fall back to the widget', async () => {
    const m = makeService({
      charge: jest.fn().mockResolvedValue(
        makeCharge({
          status: 'rejected',
          rejectionReason: 'AUTHENTICATION_REQUIRED',
        }),
      ),
    });

    await pay(m);

    expect(m.apply).toHaveBeenCalledWith(
      'attempt-1',
      expect.objectContaining({ rejectionReason: 'AUTHENTICATION_REQUIRED' }),
    );
  });

  it('a pending answer keeps the attempt PENDING and records the payment id so a notification can find it', async () => {
    const m = makeService({
      charge: jest.fn().mockResolvedValue(makeCharge({ status: 'pending' })),
    });

    const result = await pay(m);

    expect(m.apply).not.toHaveBeenCalled();
    expect(m.attachProviderPaymentIdIfPending).toHaveBeenCalledWith(
      'attempt-1',
      'payment_1',
    );
    expect(result).toMatchObject({ providerPaymentId: 'payment_1' });
  });

  it('never approves money that does not reconcile to the attempt (amount/currency)', async () => {
    const m = makeService({
      charge: jest.fn().mockResolvedValue(makeCharge({ amount: 1 })),
    });

    await expect(pay(m)).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    });
    expect(m.apply).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'saved_card_payment_amount_mismatch' }),
    );
  });

  describe('ownership and preconditions — nothing is charged and no attempt is created', () => {
    it('the anti-enumeration engagementNotFound() from the access check', async () => {
      const m = makeService({ accessError: engagementNotFound() });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_FOUND',
      });
      expect(m.createPending).not.toHaveBeenCalled();
    });

    it("a card that is not the caller's (or does not exist) is SAVED_CARD_NOT_FOUND", async () => {
      const m = makeService({ card: null });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'SAVED_CARD_NOT_FOUND',
      });
      expect(m.findCardOfCustomer).toHaveBeenCalledWith('saved-1', 'profile-1');
      expect(m.createPending).not.toHaveBeenCalled();
      expect(m.chargeSavedCard).not.toHaveBeenCalled();
    });

    it('a card saved in ANOTHER Rapyd environment than the current one is SAVED_CARD_NOT_FOUND', async () => {
      const m = makeService({
        link: { providerCustomerId: 'cus_prod', environment: 'production' },
      });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'SAVED_CARD_NOT_FOUND',
      });
      expect(m.chargeSavedCard).not.toHaveBeenCalled();
    });

    it('a Customer with no Rapyd customer at all has no chargeable card', async () => {
      const m = makeService({ link: null });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'SAVED_CARD_NOT_FOUND',
      });
    });

    it.each([EngagementStatus.ACCEPTED, EngagementStatus.CANCELLED])(
      'an Engagement in status %s is not payable',
      async (status) => {
        const m = makeService({ engagement: { status } });

        await expect(pay(m)).rejects.toMatchObject({
          code: 'ENGAGEMENT_NOT_PAYABLE_BY_CARD',
        });
        expect(m.createPending).not.toHaveBeenCalled();
      },
    );

    it('an Engagement committed to CASH is not payable by card', async () => {
      const m = makeService({
        engagement: { paymentMethod: PaymentMethod.CASH },
      });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_PAYABLE_BY_CARD',
      });
    });

    it('missing Rapyd credentials are PAYMENT_PROVIDER_NOT_CONFIGURED before any attempt exists', async () => {
      const m = makeService({
        linkError: new PaymentProviderNotConfiguredError('access key missing'),
      });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      });
      expect(m.createPending).not.toHaveBeenCalled();
    });
  });

  describe('the payment slot', () => {
    it('another active attempt (e.g. an open Rapyd checkout) is CARD_PAYMENT_ALREADY_IN_PROGRESS', async () => {
      const m = makeService({
        createPendingError: p2002(),
        active: makeAttempt({ method: PaymentMethod.RAPYD }),
      });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'CARD_PAYMENT_ALREADY_IN_PROGRESS',
      });
      expect(m.chargeSavedCard).not.toHaveBeenCalled();
    });

    it('a cash confirmation that won the race is PAYMENT_METHOD_CONFLICT', async () => {
      const m = makeService({
        createPendingError: p2002(),
        active: makeAttempt({ method: PaymentMethod.CASH }),
      });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'PAYMENT_METHOD_CONFLICT',
      });
    });
  });

  describe('provider failures', () => {
    it('a refused request rejects the attempt with the provider reason', async () => {
      const m = makeService({
        charge: jest
          .fn()
          .mockRejectedValue(new PaymentRequestRejectedError('PROVIDER_ERROR')),
      });

      await pay(m);

      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'PROVIDER_ERROR',
      });
    });

    it('credentials rejected mid-flight reject the attempt (so it does not block a retry) and surface PAYMENT_PROVIDER_NOT_CONFIGURED', async () => {
      const m = makeService({
        charge: jest
          .fn()
          .mockRejectedValue(new PaymentProviderNotConfiguredError('rejected')),
      });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      });
      expect(m.apply).toHaveBeenCalledWith(
        'attempt-1',
        expect.objectContaining({ status: 'rejected' }),
      );
    });

    it('an UNKNOWN outcome (timeout/5xx) leaves the attempt PENDING — a charge may exist — and is PAYMENT_PROVIDER_UNAVAILABLE', async () => {
      const m = makeService({
        charge: jest
          .fn()
          .mockRejectedValue(new PaymentProviderUnavailableError('timeout')),
      });

      await expect(pay(m)).rejects.toMatchObject({
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      });
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('if Rapyd approved but recording failed, the provider payment id is logged for reconciliation and the error is rethrown', async () => {
      const m = makeService();
      m.apply.mockRejectedValueOnce(new Error('ledger down'));

      await expect(pay(m)).rejects.toThrow('ledger down');
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'saved_card_payment_provider_answered_but_not_recorded',
          providerPaymentId: 'payment_1',
        }),
      );
    });
  });
});
