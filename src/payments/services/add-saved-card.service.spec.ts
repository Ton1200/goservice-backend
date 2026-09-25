import { Logger } from '@nestjs/common';
import { CountryCode, PaymentMethod } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
  ProviderSavedCard,
} from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { AddSavedCardService } from './add-saved-card.service';
import { MercadoPagoSavedCardsCustomerService } from './mercadopago-saved-cards-customer.service';

const TOKEN = 'ff8080814c11e237014c1ff593b57b4d';
const STORED: ProviderSavedCard = {
  providerCardId: '9876543210',
  brand: 'master',
  lastFour: '0604',
  type: 'credit_card',
  expirationMonth: 11,
  expirationYear: 2030,
};

describe('AddSavedCardService (GOS-150 — save a card without a payment)', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  function make(options?: {
    profile?: Record<string, unknown> | null;
    cardEnabled?: boolean;
    savedCardsEnabled?: boolean;
    configured?: boolean;
    associate?: jest.Mock;
  }) {
    const profile =
      options?.profile === undefined
        ? { id: 'profile-1', country: CountryCode.AR }
        : options.profile;
    const profilesRepository = {
      findCustomerProfileByUserId: jest.fn().mockResolvedValue(profile),
    } as unknown as ProfilesRepository;
    const platformSettingPort = {
      isEnabled: jest.fn((key: string) =>
        Promise.resolve(
          key.endsWith('saved-cards-enabled')
            ? (options?.savedCardsEnabled ?? true)
            : (options?.cardEnabled ?? true),
        ),
      ),
    } as unknown as PlatformSettingPort;
    const associateCard =
      options?.associate ?? jest.fn().mockResolvedValue(STORED);
    const listSavedCards = jest.fn().mockResolvedValue([STORED]);
    const isConfigured = jest
      .fn()
      .mockResolvedValue(options?.configured ?? true);
    const registry = {
      forMethod: jest.fn(() => ({ isConfigured })),
      saveCardOnCharge: jest.fn(() => ({ associateCard })),
      savedCards: jest.fn(() => ({ listSavedCards })),
    } as unknown as PaymentProviderRegistry;
    const ensure = jest.fn().mockResolvedValue({
      providerCustomerId: 'cus_1',
      environment: 'sandbox',
    });
    const customerService = {
      ensure,
    } as unknown as MercadoPagoSavedCardsCustomerService;
    const syncCards = jest.fn().mockResolvedValue([
      {
        id: 'saved-1',
        method: PaymentMethod.MERCADOPAGO,
        providerCardId: STORED.providerCardId,
      },
    ]);
    const savedCardRepository = {
      syncCards,
    } as unknown as SavedCardRepository;
    return {
      service: new AddSavedCardService(
        profilesRepository,
        platformSettingPort,
        registry,
        customerService,
        savedCardRepository,
      ),
      associateCard,
      ensure,
      syncCards,
    };
  }

  it("associates the fresh token to the Customer's own Mercado Pago customer and returns the synced card", async () => {
    const m = make();

    const saved = await m.service.addSavedCard('user-1', TOKEN);

    expect(m.ensure).toHaveBeenCalledWith(
      { id: 'profile-1', country: CountryCode.AR },
      'user-1',
      CountryCode.AR,
    );
    expect(m.associateCard).toHaveBeenCalledWith(
      'cus_1',
      TOKEN,
      CountryCode.AR,
    );
    expect(m.syncCards).toHaveBeenCalledWith(
      'profile-1',
      PaymentMethod.MERCADOPAGO,
      'sandbox',
      [STORED],
    );
    expect(saved.id).toBe('saved-1');
  });

  it('is refused with the switch OFF — nothing is sent to Mercado Pago', async () => {
    const m = make({ savedCardsEnabled: false });

    await expect(m.service.addSavedCard('user-1', TOKEN)).rejects.toMatchObject(
      { code: 'MERCADOPAGO_SAVED_CARDS_DISABLED' },
    );
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it('is refused with the Mercado Pago card method OFF', async () => {
    const m = make({ cardEnabled: false });

    await expect(m.service.addSavedCard('user-1', TOKEN)).rejects.toMatchObject(
      { code: 'CARD_PAYMENT_MODULE_DISABLED' },
    );
  });

  it('requires a Customer profile', async () => {
    const m = make({ profile: null });

    await expect(m.service.addSavedCard('user-1', TOKEN)).rejects.toMatchObject(
      { code: 'CUSTOMER_PROFILE_REQUIRED' },
    );
  });

  it('rejects a malformed token before calling the provider', async () => {
    const m = make();

    await expect(
      m.service.addSavedCard('user-1', '4509 9535 6623 3704'),
    ).rejects.toMatchObject({ code: 'INVALID_CARD_PAYMENT_INPUT' });
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it('maps provider outcomes to domain codes', async () => {
    const refused = make({
      associate: jest
        .fn()
        .mockRejectedValue(new PaymentRequestRejectedError('OTHER')),
    });
    await expect(
      refused.service.addSavedCard('user-1', TOKEN),
    ).rejects.toMatchObject({ code: 'INVALID_CARD_PAYMENT_INPUT' });

    const notConfigured = make({
      associate: jest
        .fn()
        .mockRejectedValue(new PaymentProviderNotConfiguredError('x')),
    });
    await expect(
      notConfigured.service.addSavedCard('user-1', TOKEN),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });

    const down = make({
      associate: jest
        .fn()
        .mockRejectedValue(new PaymentProviderUnavailableError('HTTP 503')),
    });
    await expect(
      down.service.addSavedCard('user-1', TOKEN),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
  });

  it('canAddSavedCard is true only for a Customer, both switches ON and a configured country', async () => {
    await expect(make().service.canAddSavedCard('user-1')).resolves.toBe(true);
    await expect(
      make({ savedCardsEnabled: false }).service.canAddSavedCard('user-1'),
    ).resolves.toBe(false);
    await expect(
      make({ cardEnabled: false }).service.canAddSavedCard('user-1'),
    ).resolves.toBe(false);
    await expect(
      make({ configured: false }).service.canAddSavedCard('user-1'),
    ).resolves.toBe(false);
    await expect(
      make({ profile: null }).service.canAddSavedCard('user-1'),
    ).resolves.toBe(false);
  });
});
