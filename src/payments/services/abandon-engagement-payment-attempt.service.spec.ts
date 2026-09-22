import { Logger } from '@nestjs/common';
import { PaymentAttemptStatus, PaymentMethod } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { PaymentProviderCapabilityError } from '../ports/payment-provider.port';
import { AbandonEngagementPaymentAttemptService } from './abandon-engagement-payment-attempt.service';
import { ApplyPaymentResultService } from './apply-payment-result.service';

function makeAttempt(overrides?: Record<string, unknown>) {
  return {
    id: 'attempt-1',
    engagementId: 'engagement-1',
    method: PaymentMethod.RAPYD,
    status: PaymentAttemptStatus.PENDING,
    providerPaymentId: null,
    providerCheckoutId: 'checkout_1',
    amount: 50000,
    currency: 'ARS',
    ...overrides,
  };
}

function makeSnapshot(overrides?: Record<string, unknown>) {
  return {
    checkoutId: 'checkout_1',
    status: 'pending',
    providerPaymentId: null,
    paymentCreated: false,
    open: true,
    externalReference: 'engagement-1',
    amount: 50000,
    currency: 'ARS',
    ...overrides,
  };
}

describe('AbandonEngagementPaymentAttemptService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  function makeService(options?: {
    accessError?: Error;
    active?: ReturnType<typeof makeAttempt> | null;
    getCheckoutSnapshot?: jest.Mock;
    applyResult?: Record<string, unknown> | null;
  }) {
    const resolveCustomerEngagement = options?.accessError
      ? jest.fn().mockRejectedValue(options.accessError)
      : jest.fn().mockResolvedValue({ id: 'engagement-1' });
    const accessService = {
      resolveCustomerEngagement,
    } as unknown as CardPaymentAccessService;

    const findByIdWithBillingContext = jest
      .fn()
      .mockResolvedValue({ customerProfile: { country: 'AR' } });
    const engagementsRepository = {
      findByIdWithBillingContext,
    } as unknown as EngagementsRepository;

    const findActiveByEngagementId = jest
      .fn()
      .mockResolvedValue(
        options?.active === undefined ? makeAttempt() : options.active,
      );
    const paymentAttemptRepository = {
      findActiveByEngagementId,
    } as unknown as PaymentAttemptRepository;

    const getCheckoutSnapshot =
      options?.getCheckoutSnapshot ??
      jest.fn().mockResolvedValue(makeSnapshot());
    const embeddedCheckout = jest.fn((method: PaymentMethod) => {
      if (method !== PaymentMethod.RAPYD) {
        throw new PaymentProviderCapabilityError(method, 'EMBEDDED_CHECKOUT');
      }
      return { getCheckoutSnapshot };
    });
    const registry = { embeddedCheckout } as unknown as PaymentProviderRegistry;

    const apply = jest.fn().mockResolvedValue(
      options?.applyResult === undefined
        ? makeAttempt({
            status: PaymentAttemptStatus.REJECTED,
            rejectionReason: 'ABANDONED',
          })
        : options.applyResult,
    );
    const applyService = { apply } as unknown as ApplyPaymentResultService;

    const service = new AbandonEngagementPaymentAttemptService(
      accessService,
      engagementsRepository,
      paymentAttemptRepository,
      registry,
      applyService,
    );
    return { service, getCheckoutSnapshot, apply, findActiveByEngagementId };
  }

  it('closes an unpaid embedded-checkout attempt as REJECTED with the generic ABANDONED reason — after re-reading the provider — and returns it', async () => {
    const m = makeService();

    const result = await m.service.abandonEngagementPaymentAttempt(
      'user-1',
      'engagement-1',
    );

    expect(m.getCheckoutSnapshot).toHaveBeenCalledWith('checkout_1', 'AR');
    expect(m.apply).toHaveBeenCalledWith('attempt-1', {
      status: 'rejected',
      providerPaymentId: null,
      rejectionReason: 'ABANDONED',
    });
    expect(m.getCheckoutSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      m.apply.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      status: PaymentAttemptStatus.REJECTED,
      rejectionReason: 'ABANDONED',
    });
  });

  it('an EXPIRED checkout is closed with the provider\'s own reason, not "abandoned"', async () => {
    const m = makeService({
      getCheckoutSnapshot: jest.fn().mockResolvedValue(
        makeSnapshot({
          status: 'rejected',
          rejectionReason: 'OTHER',
          open: false,
        }),
      ),
    });

    await m.service.abandonEngagementPaymentAttempt('user-1', 'engagement-1');

    expect(m.apply).toHaveBeenCalledWith('attempt-1', {
      status: 'rejected',
      providerPaymentId: null,
      rejectionReason: 'OTHER',
    });
  });

  it('REFUSES when a payment was already created inside the checkout (money may have moved) — and does not close it', async () => {
    const m = makeService({
      getCheckoutSnapshot: jest.fn().mockResolvedValue(
        makeSnapshot({
          providerPaymentId: 'payment_1',
          paymentCreated: true,
        }),
      ),
    });

    await expect(
      m.service.abandonEngagementPaymentAttempt('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_ABANDONABLE' });
    expect(m.apply).not.toHaveBeenCalled();
  });

  it('a checkout that turns out to be PAID is recorded (a real payment is never discarded) and then refused', async () => {
    const m = makeService({
      getCheckoutSnapshot: jest.fn().mockResolvedValue(
        makeSnapshot({
          status: 'approved',
          providerPaymentId: 'payment_1',
          paymentCreated: true,
          open: false,
        }),
      ),
    });

    await expect(
      m.service.abandonEngagementPaymentAttempt('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_ABANDONABLE' });
    expect(m.apply).toHaveBeenCalledWith('attempt-1', {
      status: 'approved',
      providerPaymentId: 'payment_1',
    });
  });

  it('changes NOTHING when the provider cannot be read', async () => {
    const m = makeService({
      getCheckoutSnapshot: jest.fn().mockRejectedValue(new Error('timeout')),
    });

    await expect(
      m.service.abandonEngagementPaymentAttempt('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'PAYMENT_CHECKOUT_UNAVAILABLE' });
    expect(m.apply).not.toHaveBeenCalled();
  });

  it('changes NOTHING when the provider no longer knows the checkout', async () => {
    const m = makeService({
      getCheckoutSnapshot: jest.fn().mockResolvedValue(null),
    });

    await expect(
      m.service.abandonEngagementPaymentAttempt('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'PAYMENT_CHECKOUT_UNAVAILABLE' });
    expect(m.apply).not.toHaveBeenCalled();
  });

  it('refuses when the CAS was lost (a webhook approved it between the read and the close)', async () => {
    const m = makeService({
      applyResult: makeAttempt({ status: PaymentAttemptStatus.APPROVED }),
    });

    await expect(
      m.service.abandonEngagementPaymentAttempt('user-1', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_ABANDONABLE' });
  });

  it.each([
    ['there is no active attempt', null],
    [
      'the active attempt is already APPROVED',
      makeAttempt({ status: PaymentAttemptStatus.APPROVED }),
    ],
    [
      'the active attempt is a Mercado Pago one (it resolves through its own provider flow)',
      makeAttempt({ method: PaymentMethod.MERCADOPAGO }),
    ],
    [
      'the active attempt is a cash confirmation',
      makeAttempt({ method: PaymentMethod.CASH, providerCheckoutId: null }),
    ],
    [
      'the attempt never got a checkout id (restart it instead)',
      makeAttempt({ providerCheckoutId: null }),
    ],
  ])(
    'refuses when %s — and never calls the provider',
    async (_label, active) => {
      const m = makeService({ active });

      await expect(
        m.service.abandonEngagementPaymentAttempt('user-1', 'engagement-1'),
      ).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_ABANDONABLE' });
      expect(m.getCheckoutSnapshot).not.toHaveBeenCalled();
      expect(m.apply).not.toHaveBeenCalled();
    },
  );

  it("anyone but the Engagement's own Customer gets the anti-enumeration engagementNotFound()", async () => {
    const m = makeService({ accessError: engagementNotFound() });

    await expect(
      m.service.abandonEngagementPaymentAttempt('user-2', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect(m.findActiveByEngagementId).not.toHaveBeenCalled();
  });
});
