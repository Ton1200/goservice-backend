import { Logger } from '@nestjs/common';
import {
  EngagementStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';
import { StartEngagementRapydCheckoutService } from './start-engagement-rapyd-checkout.service';

const SCRIPT_URL = 'https://sandboxcheckouttoolkit.rapyd.net';

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
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('StartEngagementRapydCheckoutService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  function makeService(options?: {
    accessError?: Error;
    engagement?: Record<string, unknown>;
    active?: ReturnType<typeof makeAttempt> | null;
    createPendingError?: Error;
    createCheckout?: jest.Mock;
    getCheckoutSnapshot?: jest.Mock;
    getToolkitScriptUrl?: jest.Mock;
    /** `payments.payment-methods.rapyd.saved-cards-enabled` — OFF by default. */
    savedCardsEnabled?: boolean;
    ensureCustomer?: jest.Mock;
    /** Cards already in the Customer's Rapyd vault (default none). */
    vaultCards?: unknown[];
    listSavedCards?: jest.Mock;
  }) {
    const engagement = {
      id: 'engagement-1',
      status: EngagementStatus.IN_PROGRESS,
      paymentMethod: null,
      ...options?.engagement,
    };
    const resolveCustomerEngagement = options?.accessError
      ? jest.fn().mockRejectedValue(options.accessError)
      : jest.fn().mockResolvedValue(engagement);
    const accessService = {
      resolveCustomerEngagement,
    } as unknown as CardPaymentAccessService;

    const findByIdWithBillingContext = jest.fn().mockResolvedValue({
      quote: { price: 60000, negotiatedPrice: 50000 },
      customerProfile: { country: 'AR' },
    });
    const engagementsRepository = {
      findByIdWithBillingContext,
    } as unknown as EngagementsRepository;

    const createPending = options?.createPendingError
      ? jest.fn().mockRejectedValue(options.createPendingError)
      : jest.fn().mockResolvedValue(makeAttempt());
    // `undefined` -> no active attempt; the first call answers the slot check,
    // any later call (after a P2002) answers "who won the race".
    const findActiveByEngagementId = jest
      .fn()
      .mockResolvedValue(options?.active ?? null);
    const attachProviderCheckoutIdIfPending = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    const findById = jest
      .fn()
      .mockResolvedValue(makeAttempt({ providerCheckoutId: 'checkout_1' }));
    const paymentAttemptRepository = {
      createPending,
      findActiveByEngagementId,
      attachProviderCheckoutIdIfPending,
      findById,
    } as unknown as PaymentAttemptRepository;

    const createCheckout =
      options?.createCheckout ??
      jest.fn().mockResolvedValue({
        checkoutId: 'checkout_1',
        toolkitScriptUrl: SCRIPT_URL,
      });
    const getCheckoutSnapshot =
      options?.getCheckoutSnapshot ??
      jest.fn().mockResolvedValue(makeSnapshot());
    const getToolkitScriptUrl =
      options?.getToolkitScriptUrl ?? jest.fn().mockResolvedValue(SCRIPT_URL);
    const provider = {
      createCheckout,
      getCheckoutSnapshot,
      getToolkitScriptUrl,
    };
    const embeddedCheckout = jest.fn().mockReturnValue(provider);
    const listSavedCards =
      options?.listSavedCards ??
      jest.fn().mockResolvedValue(options?.vaultCards ?? []);
    const savedCards = jest.fn().mockReturnValue({ listSavedCards });
    const registry = {
      embeddedCheckout,
      savedCards,
    } as unknown as PaymentProviderRegistry;

    const apply = jest.fn().mockResolvedValue(makeAttempt());
    const applyService = { apply } as unknown as ApplyPaymentResultService;

    const isEnabled = jest
      .fn()
      .mockResolvedValue(options?.savedCardsEnabled ?? false);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    const findCustomerProfileByUserId = jest.fn().mockResolvedValue({
      id: 'profile-1',
      firstName: 'Ana',
      lastName: 'Paz',
    });
    const profilesRepository = {
      findCustomerProfileByUserId,
    } as unknown as ProfilesRepository;
    const ensure =
      options?.ensureCustomer ??
      jest.fn().mockResolvedValue({
        providerCustomerId: 'cus_1',
        environment: 'sandbox',
      });
    const customerService = {
      ensure,
    } as unknown as RapydSavedCardsCustomerService;

    const service = new StartEngagementRapydCheckoutService(
      accessService,
      engagementsRepository,
      paymentAttemptRepository,
      registry,
      applyService,
      platformSettingPort,
      profilesRepository,
      customerService,
    );
    return {
      service,
      isEnabled,
      ensure,
      listSavedCards,
      createPending,
      findActiveByEngagementId,
      attachProviderCheckoutIdIfPending,
      createCheckout,
      getCheckoutSnapshot,
      getToolkitScriptUrl,
      apply,
    };
  }

  describe('saved cards (GOS-146)', () => {
    it('with the switch OFF the checkout is created WITHOUT a Rapyd customer and none is created', async () => {
      const m = makeService({ savedCardsEnabled: false });

      await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(m.isEnabled).toHaveBeenCalledWith(
        'payments.payment-methods.rapyd.saved-cards-enabled',
      );
      expect(m.ensure).not.toHaveBeenCalled();
      expect(
        (m.createCheckout.mock.calls[0] as [{ customerId?: string }])[0]
          .customerId,
      ).toBeUndefined();
    });

    it("with the switch ON the checkout is linked to the Customer's Rapyd customer (which makes the widget offer to save the card)", async () => {
      const m = makeService({ savedCardsEnabled: true });

      await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(m.ensure).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'profile-1' }),
        'user-1',
      );
      expect(m.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_1' }),
      );
    });

    it('a Customer who ALREADY has a saved card gets an UNLINKED checkout — the widget would default to a saved-card view that fails in this Rapyd account', async () => {
      const m = makeService({
        savedCardsEnabled: true,
        vaultCards: [{ providerCardId: 'card_1' }],
      });

      const result = await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(result.checkoutId).toBe('checkout_1');
      expect(m.listSavedCards).toHaveBeenCalledWith('cus_1');
      expect(
        (m.createCheckout.mock.calls[0] as [{ customerId?: string }])[0]
          .customerId,
      ).toBeUndefined();
    });

    it('if the vault cannot be read the checkout is created unlinked — never blocked, never a broken default', async () => {
      const m = makeService({
        savedCardsEnabled: true,
        listSavedCards: jest
          .fn()
          .mockRejectedValue(new PaymentProviderUnavailableError('HTTP 503')),
      });

      const result = await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(result.checkoutId).toBe('checkout_1');
      expect(
        (m.createCheckout.mock.calls[0] as [{ customerId?: string }])[0]
          .customerId,
      ).toBeUndefined();
    });

    it('if the Rapyd customer cannot be prepared the payment is NOT blocked: the checkout is created without it', async () => {
      const m = makeService({
        savedCardsEnabled: true,
        ensureCustomer: jest
          .fn()
          .mockRejectedValue(new PaymentProviderUnavailableError('HTTP 503')),
      });

      const result = await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(result.checkoutId).toBe('checkout_1');
      expect(
        (m.createCheckout.mock.calls[0] as [{ customerId?: string }])[0]
          .customerId,
      ).toBeUndefined();
    });
  });

  describe('a new checkout', () => {
    it('inserts the RAPYD PENDING attempt (instalments 1) from SERVER-derived values BEFORE calling Rapyd, then creates the checkout with the attempt id as idempotency key and records the checkout id', async () => {
      const m = makeService();

      const result = await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(m.createPending).toHaveBeenCalledWith({
        engagementId: 'engagement-1',
        method: PaymentMethod.RAPYD,
        amount: 50000, // negotiatedPrice ?? price
        currency: 'ARS',
        installments: 1,
      });
      expect(m.createCheckout).toHaveBeenCalledWith({
        amount: 50000,
        currency: 'ARS',
        country: 'AR',
        description: 'GoService — Engagement engagement-1',
        externalReference: 'engagement-1',
        idempotencyKey: 'attempt-1',
      });
      expect(m.createPending.mock.invocationCallOrder[0]).toBeLessThan(
        m.createCheckout.mock.invocationCallOrder[0],
      );
      expect(m.attachProviderCheckoutIdIfPending).toHaveBeenCalledWith(
        'attempt-1',
        'checkout_1',
      );
      expect(result).toMatchObject({
        checkoutId: 'checkout_1',
        toolkitScriptUrl: SCRIPT_URL,
      });
      // It never approves anything: the payment happens later, in the widget.
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('the owner check failure surfaces the anti-enumeration engagementNotFound() and nothing is created', async () => {
      const m = makeService({ accessError: engagementNotFound() });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
      expect(m.createPending).not.toHaveBeenCalled();
    });

    it.each([[EngagementStatus.ACCEPTED], [EngagementStatus.CANCELLED]])(
      'refuses an Engagement in status %s',
      async (status) => {
        const m = makeService({ engagement: { status } });

        await expect(
          m.service.startEngagementRapydCheckout('user-1', {
            engagementId: 'engagement-1',
          }),
        ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_PAYABLE_BY_CARD' });
        expect(m.createPending).not.toHaveBeenCalled();
      },
    );

    it('refuses an Engagement already committed to CASH', async () => {
      const m = makeService({
        engagement: { paymentMethod: PaymentMethod.CASH },
      });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_PAYABLE_BY_CARD' });
    });

    it.each([
      ['a cash attempt', PaymentMethod.CASH, 'PAYMENT_METHOD_CONFLICT'],
      [
        'another provider (Mercado Pago) holding the slot',
        PaymentMethod.MERCADOPAGO,
        'CARD_PAYMENT_ALREADY_IN_PROGRESS',
      ],
    ])(
      'a P2002 from the partial unique index (%s won the race) maps to the existing domain error',
      async (_label, method, code) => {
        const m = makeService({ createPendingError: p2002() });
        m.findActiveByEngagementId
          .mockResolvedValueOnce(null) // the slot check saw nothing…
          .mockResolvedValueOnce(makeAttempt({ method })); // …then someone won

        await expect(
          m.service.startEngagementRapydCheckout('user-1', {
            engagementId: 'engagement-1',
          }),
        ).rejects.toMatchObject({ code });
        expect(m.createCheckout).not.toHaveBeenCalled();
      },
    );

    it('rethrows an unexpected persistence error untouched', async () => {
      const boom = new Error('db down');
      const m = makeService({ createPendingError: boom });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toBe(boom);
    });
  });

  describe('failure of the checkout creation', () => {
    it('provider NOT CONFIGURED -> attempt REJECTED (PROVIDER_ERROR) so it does not linger, and the country-specific misconfiguration error', async () => {
      const m = makeService({
        createCheckout: jest
          .fn()
          .mockRejectedValue(new PaymentProviderNotConfiguredError('no keys')),
      });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      });
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'PROVIDER_ERROR',
      });
    });

    it('Rapyd definitively refuses (no checkout created) -> attempt REJECTED with that reason', async () => {
      const m = makeService({
        createCheckout: jest
          .fn()
          .mockRejectedValue(new PaymentRequestRejectedError('PROVIDER_ERROR')),
      });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({ code: 'PAYMENT_CHECKOUT_UNAVAILABLE' });
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'PROVIDER_ERROR',
      });
    });

    it('TIMEOUT / 5xx (outcome unknown) -> the attempt is left PENDING — never assumed rejected', async () => {
      const m = makeService({
        createCheckout: jest
          .fn()
          .mockRejectedValue(new PaymentProviderUnavailableError('timeout')),
      });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
      expect(m.apply).not.toHaveBeenCalled();
      expect(m.attachProviderCheckoutIdIfPending).not.toHaveBeenCalled();
    });
  });

  describe('restarting when the Engagement already has an active attempt (the abandoned-widget case)', () => {
    it('an unpaid, still-valid checkout returns the SAME checkoutId — no new attempt, no new checkout', async () => {
      const active = makeAttempt({ providerCheckoutId: 'checkout_1' });
      const m = makeService({ active });

      const result = await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(m.getCheckoutSnapshot).toHaveBeenCalledWith('checkout_1', 'AR');
      expect(result.checkoutId).toBe('checkout_1');
      expect(result.toolkitScriptUrl).toBe(SCRIPT_URL);
      expect(result.attempt).toBe(active);
      expect(m.createPending).not.toHaveBeenCalled();
      expect(m.createCheckout).not.toHaveBeenCalled();
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('an EXPIRED / blocked checkout closes that attempt as REJECTED and creates a NEW one', async () => {
      const m = makeService({
        active: makeAttempt({ providerCheckoutId: 'checkout_old' }),
        getCheckoutSnapshot: jest.fn().mockResolvedValue(
          makeSnapshot({
            checkoutId: 'checkout_old',
            status: 'rejected',
            rejectionReason: 'OTHER',
            open: false,
          }),
        ),
      });
      m.createPending.mockResolvedValue(makeAttempt({ id: 'attempt-2' }));

      const result = await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'OTHER',
      });
      expect(m.createPending).toHaveBeenCalledTimes(1);
      expect(m.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'attempt-2' }),
      );
      expect(result.checkoutId).toBe('checkout_1');
    });

    it('a checkout that turns out to be PAID is applied and answered with the already-paid conflict — nothing new is created', async () => {
      const m = makeService({
        active: makeAttempt({ providerCheckoutId: 'checkout_1' }),
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
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({ code: 'CARD_PAYMENT_ALREADY_IN_PROGRESS' });
      expect(m.apply).toHaveBeenCalledWith('attempt-1', {
        status: 'approved',
        providerPaymentId: 'payment_1',
      });
      expect(m.createPending).not.toHaveBeenCalled();
    });

    it('a "paid" checkout whose amount does not reconcile is NOT applied', async () => {
      const m = makeService({
        active: makeAttempt({ providerCheckoutId: 'checkout_1' }),
        getCheckoutSnapshot: jest.fn().mockResolvedValue(
          makeSnapshot({
            status: 'approved',
            providerPaymentId: 'payment_1',
            paymentCreated: true,
            open: false,
            amount: 1,
          }),
        ),
      });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({ code: 'PAYMENT_CHECKOUT_UNAVAILABLE' });
      expect(m.apply).not.toHaveBeenCalled();
    });

    it('an attempt whose create call never answered (no checkout id) repeats it with the SAME idempotency key and records the id', async () => {
      const m = makeService({ active: makeAttempt() });

      const result = await m.service.startEngagementRapydCheckout('user-1', {
        engagementId: 'engagement-1',
      });

      expect(m.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'attempt-1', amount: 50000 }),
      );
      expect(m.createPending).not.toHaveBeenCalled();
      expect(m.attachProviderCheckoutIdIfPending).toHaveBeenCalledWith(
        'attempt-1',
        'checkout_1',
      );
      expect(result.checkoutId).toBe('checkout_1');
    });

    it('an unreadable checkout changes NOTHING and answers PAYMENT_CHECKOUT_UNAVAILABLE', async () => {
      const m = makeService({
        active: makeAttempt({ providerCheckoutId: 'checkout_1' }),
        getCheckoutSnapshot: jest
          .fn()
          .mockRejectedValue(new PaymentProviderUnavailableError('timeout')),
      });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({ code: 'PAYMENT_CHECKOUT_UNAVAILABLE' });
      expect(m.apply).not.toHaveBeenCalled();
      expect(m.createPending).not.toHaveBeenCalled();
    });

    it('a checkout Rapyd no longer knows changes nothing either', async () => {
      const m = makeService({
        active: makeAttempt({ providerCheckoutId: 'checkout_1' }),
        getCheckoutSnapshot: jest.fn().mockResolvedValue(null),
      });

      await expect(
        m.service.startEngagementRapydCheckout('user-1', {
          engagementId: 'engagement-1',
        }),
      ).rejects.toMatchObject({ code: 'PAYMENT_CHECKOUT_UNAVAILABLE' });
      expect(m.apply).not.toHaveBeenCalled();
    });

    it.each([
      [
        'cash',
        PaymentMethod.CASH,
        PaymentAttemptStatus.PENDING,
        'PAYMENT_METHOD_CONFLICT',
      ],
      [
        'Mercado Pago (PENDING)',
        PaymentMethod.MERCADOPAGO,
        PaymentAttemptStatus.PENDING,
        'CARD_PAYMENT_ALREADY_IN_PROGRESS',
      ],
      [
        'Mercado Pago (already paid)',
        PaymentMethod.MERCADOPAGO,
        PaymentAttemptStatus.APPROVED,
        'CARD_PAYMENT_ALREADY_IN_PROGRESS',
      ],
      [
        'Rapyd (already paid)',
        PaymentMethod.RAPYD,
        PaymentAttemptStatus.APPROVED,
        'CARD_PAYMENT_ALREADY_IN_PROGRESS',
      ],
    ])(
      'an active %s attempt refuses a new Rapyd checkout without touching Rapyd',
      async (_label, method, status, code) => {
        const m = makeService({ active: makeAttempt({ method, status }) });

        await expect(
          m.service.startEngagementRapydCheckout('user-1', {
            engagementId: 'engagement-1',
          }),
        ).rejects.toMatchObject({ code });
        expect(m.createPending).not.toHaveBeenCalled();
        expect(m.createCheckout).not.toHaveBeenCalled();
        expect(m.getCheckoutSnapshot).not.toHaveBeenCalled();
      },
    );
  });
});
