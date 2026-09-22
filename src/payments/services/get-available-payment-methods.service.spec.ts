import {
  EngagementStatus,
  PaymentAttemptStatus,
  PaymentMethod,
} from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentOptionKind } from '../models/payment-option-kind.enum';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { GetAvailablePaymentMethodsService } from './get-available-payment-methods.service';

const KEYS = {
  cashEnabled: 'payments.payment-methods.cash.enabled',
  cardEnabled: 'payments.payment-methods.mercadopago.card.enabled',
  walletEnabled: 'payments.payment-methods.mercadopago.wallet.enabled',
  rapydEnabled: 'payments.payment-methods.rapyd.enabled',
};
// NOT in `KEYS`: the default ("every flag ON") deliberately leaves saved cards OFF.
const SAVED_CARDS_ENABLED_KEY =
  'payments.payment-methods.rapyd.saved-cards-enabled';

describe('GetAvailablePaymentMethodsService', () => {
  function makeService(options?: {
    accessError?: Error;
    engagement?: Record<string, unknown>;
    active?: Record<string, unknown> | null;
    /** Which flags are ON (default: all). */
    enabled?: string[];
    settings?: Record<string, string>;
    mpConfigured?: boolean;
    mpWalletConfigured?: boolean;
    rapydConfigured?: boolean;
  }) {
    const resolveCustomerEngagement = options?.accessError
      ? jest.fn().mockRejectedValue(options.accessError)
      : jest.fn().mockResolvedValue({
          id: 'engagement-1',
          status: EngagementStatus.IN_PROGRESS,
          paymentMethod: null,
          ...options?.engagement,
        });
    const accessService = {
      resolveCustomerEngagement,
    } as unknown as CardPaymentAccessService;

    const engagementsRepository = {
      findByIdWithBillingContext: jest
        .fn()
        .mockResolvedValue({ customerProfile: { country: 'AR' } }),
    } as unknown as EngagementsRepository;

    const paymentAttemptRepository = {
      findActiveByEngagementId: jest
        .fn()
        .mockResolvedValue(options?.active ?? null),
    } as unknown as PaymentAttemptRepository;

    const mercadoPago = {
      capabilities: new Set(['CARD_TOKEN', 'WALLET_REDIRECT']),
      isConfigured: jest.fn().mockResolvedValue(options?.mpConfigured ?? true),
      isWalletConfigured: jest
        .fn()
        .mockResolvedValue(options?.mpWalletConfigured ?? true),
    };
    const rapyd = {
      capabilities: new Set(['EMBEDDED_CHECKOUT', 'SAVED_CARDS']),
      isConfigured: jest
        .fn()
        .mockResolvedValue(options?.rapydConfigured ?? true),
    };
    const registry = {
      forMethod: (method: PaymentMethod) => {
        if (method === PaymentMethod.MERCADOPAGO) return mercadoPago;
        if (method === PaymentMethod.RAPYD) return rapyd;
        throw new Error('no adapter');
      },
    } as unknown as PaymentProviderRegistry;

    const enabled = new Set(options?.enabled ?? Object.values(KEYS));
    const isEnabled = jest.fn((key: string) =>
      Promise.resolve(enabled.has(key)),
    );
    const getValue = jest.fn((key: string) =>
      Promise.resolve(options?.settings?.[key] ?? null),
    );
    const platformSettingPort = {
      isEnabled,
      getValue,
    } as unknown as PlatformSettingPort;

    const service = new GetAvailablePaymentMethodsService(
      accessService,
      engagementsRepository,
      paymentAttemptRepository,
      registry,
      platformSettingPort,
    );
    return { service, mercadoPago, rapyd };
  }

  const kinds = (options: { kind: PaymentOptionKind }[]) =>
    options.map((o) => o.kind);

  it('lists every enabled and configured option with the KIND the client must open — cash, card token, embedded checkout, wallet', async () => {
    const m = makeService();

    const options = await m.service.getAvailablePaymentMethods(
      'user-1',
      'engagement-1',
    );

    expect(options).toEqual([
      {
        method: PaymentMethod.CASH,
        kind: PaymentOptionKind.CASH,
        displayName: 'Efectivo',
        supportsSavedCards: false,
      },
      {
        method: PaymentMethod.MERCADOPAGO,
        kind: PaymentOptionKind.CARD_TOKEN,
        displayName: 'Tarjeta de crédito o débito',
        supportsSavedCards: false,
      },
      {
        method: PaymentMethod.RAPYD,
        kind: PaymentOptionKind.EMBEDDED_CHECKOUT,
        displayName: 'Tarjeta',
        supportsSavedCards: false,
      },
      {
        method: PaymentMethod.MERCADOPAGO,
        kind: PaymentOptionKind.WALLET_REDIRECT,
        displayName: 'Mercado Pago',
        supportsSavedCards: false,
      },
    ]);
  });

  describe('saved cards (GOS-146)', () => {
    const supportsSavedCards = (
      options: { method: PaymentMethod; supportsSavedCards: boolean }[],
    ) => options.filter((o) => o.supportsSavedCards).map((o) => o.method);

    it('the Rapyd option says supportsSavedCards ONLY while its saved-cards switch is ON — never the other options', async () => {
      const m = makeService({
        enabled: [...Object.values(KEYS), SAVED_CARDS_ENABLED_KEY],
      });

      const options = await m.service.getAvailablePaymentMethods(
        'user-1',
        'engagement-1',
      );

      expect(supportsSavedCards(options)).toEqual([PaymentMethod.RAPYD]);
    });

    it('with the switch OFF no option supports saved cards, and Rapyd stays a normal option', async () => {
      const m = makeService();

      const options = await m.service.getAvailablePaymentMethods(
        'user-1',
        'engagement-1',
      );

      expect(supportsSavedCards(options)).toEqual([]);
      expect(options.map((o) => o.method)).toContain(PaymentMethod.RAPYD);
    });

    it('saved cards are a feature OF Rapyd: with Rapyd itself OFF the option is not listed, whatever the saved-cards switch says', async () => {
      const m = makeService({
        enabled: [
          KEYS.cashEnabled,
          KEYS.cardEnabled,
          KEYS.walletEnabled,
          SAVED_CARDS_ENABLED_KEY,
        ],
      });

      const options = await m.service.getAvailablePaymentMethods(
        'user-1',
        'engagement-1',
      );

      expect(options.map((o) => o.method)).not.toContain(PaymentMethod.RAPYD);
      expect(supportsSavedCards(options)).toEqual([]);
    });
  });

  it('uses the admin-configured display names', async () => {
    const m = makeService({
      settings: {
        'payments.payment-methods.rapyd.display-name': '  Tarjeta (Rapyd)  ',
      },
    });

    const options = await m.service.getAvailablePaymentMethods(
      'user-1',
      'engagement-1',
    );

    expect(
      options.find((o) => o.method === PaymentMethod.RAPYD)?.displayName,
    ).toBe('Tarjeta (Rapyd)');
  });

  it('Rapyd switched OFF does not appear, and Mercado Pago still does — independent flags', async () => {
    const m = makeService({
      enabled: [KEYS.cashEnabled, KEYS.cardEnabled, KEYS.walletEnabled],
    });

    const options = await m.service.getAvailablePaymentMethods(
      'user-1',
      'engagement-1',
    );

    expect(kinds(options)).toEqual([
      PaymentOptionKind.CASH,
      PaymentOptionKind.CARD_TOKEN,
      PaymentOptionKind.WALLET_REDIRECT,
    ]);
  });

  it("Mercado Pago's card switch governs ONLY the Mercado Pago card: Rapyd stays listed with card.enabled OFF", async () => {
    const m = makeService({ enabled: [KEYS.cashEnabled, KEYS.rapydEnabled] });

    const options = await m.service.getAvailablePaymentMethods(
      'user-1',
      'engagement-1',
    );

    expect(kinds(options)).toEqual([
      PaymentOptionKind.CASH,
      PaymentOptionKind.EMBEDDED_CHECKOUT,
    ]);
  });

  it("a country without complete credentials does not get that provider's options", async () => {
    const m = makeService({ rapydConfigured: false });

    const options = await m.service.getAvailablePaymentMethods(
      'user-1',
      'engagement-1',
    );

    expect(kinds(options)).not.toContain(PaymentOptionKind.EMBEDDED_CHECKOUT);
    expect(kinds(options)).toContain(PaymentOptionKind.CARD_TOKEN);
  });

  it('the wallet also needs its redirect config; the card does not', async () => {
    const m = makeService({ mpWalletConfigured: false });

    const options = await m.service.getAvailablePaymentMethods(
      'user-1',
      'engagement-1',
    );

    expect(kinds(options)).toContain(PaymentOptionKind.CARD_TOKEN);
    expect(kinds(options)).not.toContain(PaymentOptionKind.WALLET_REDIRECT);
  });

  it('cash disabled is not offered', async () => {
    const m = makeService({ enabled: [KEYS.rapydEnabled] });

    const options = await m.service.getAvailablePaymentMethods(
      'user-1',
      'engagement-1',
    );

    expect(kinds(options)).toEqual([PaymentOptionKind.EMBEDDED_CHECKOUT]);
  });

  describe("how the Engagement's current payment state shapes the answer", () => {
    it.each([[EngagementStatus.ACCEPTED], [EngagementStatus.CANCELLED]])(
      'an Engagement in status %s is not payable -> []',
      async (status) => {
        const m = makeService({ engagement: { status } });

        await expect(
          m.service.getAvailablePaymentMethods('user-1', 'engagement-1'),
        ).resolves.toEqual([]);
      },
    );

    it('an already-paid Engagement (APPROVED attempt) -> []', async () => {
      const m = makeService({
        active: {
          method: PaymentMethod.RAPYD,
          status: PaymentAttemptStatus.APPROVED,
        },
      });

      await expect(
        m.service.getAvailablePaymentMethods('user-1', 'engagement-1'),
      ).resolves.toEqual([]);
    });

    it.each([
      [
        'committed to CASH',
        { engagement: { paymentMethod: PaymentMethod.CASH } },
      ],
      [
        'with a cash confirmation active',
        {
          active: {
            method: PaymentMethod.CASH,
            status: PaymentAttemptStatus.PENDING,
          },
        },
      ],
    ])(
      '%s -> only the CASH option (a digital one would be refused)',
      async (_label, options) => {
        const m = makeService(options);

        const result = await m.service.getAvailablePaymentMethods(
          'user-1',
          'engagement-1',
        );

        expect(kinds(result)).toEqual([PaymentOptionKind.CASH]);
      },
    );

    it('a PENDING digital attempt does NOT hide the options — the client reads it via myEngagementPaymentAttempt and abandons it to switch provider', async () => {
      const m = makeService({
        active: {
          method: PaymentMethod.RAPYD,
          status: PaymentAttemptStatus.PENDING,
        },
      });

      const result = await m.service.getAvailablePaymentMethods(
        'user-1',
        'engagement-1',
      );

      expect(kinds(result)).toContain(PaymentOptionKind.EMBEDDED_CHECKOUT);
      expect(kinds(result)).toContain(PaymentOptionKind.CARD_TOKEN);
    });
  });

  it("anyone but the Engagement's own Customer gets the anti-enumeration engagementNotFound()", async () => {
    const m = makeService({ accessError: engagementNotFound() });

    await expect(
      m.service.getAvailablePaymentMethods('user-2', 'engagement-1'),
    ).rejects.toMatchObject({
      code: 'ENGAGEMENT_NOT_FOUND',
    });
  });
});
