import { Logger } from '@nestjs/common';
import { CountryCode, PaymentMethod } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  ProviderSavedCard,
} from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { ListMySavedCardsService } from './list-my-saved-cards.service';
import { MercadoPagoSavedCardsCustomerService } from './mercadopago-saved-cards-customer.service';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';

const RAPYD_CARD: ProviderSavedCard = {
  providerCardId: 'card_1',
  brand: 'visa',
  lastFour: '1111',
  type: 'debit_card',
  expirationMonth: 12,
  expirationYear: 2030,
};

const MERCADOPAGO_CARD: ProviderSavedCard = {
  providerCardId: 'mp_card_1',
  brand: 'master',
  lastFour: '2222',
  type: 'credit_card',
  expirationMonth: 6,
  expirationYear: 2031,
};

type Link = { providerCustomerId: string; environment: string } | null;

describe('ListMySavedCardsService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  function makeService(options?: {
    profile?: Record<string, unknown> | null;
    rapydEnabled?: boolean;
    mercadoPagoEnabled?: boolean;
    rapydLink?: Link;
    mercadoPagoLink?: Link;
    linkError?: Error;
    rapydListSavedCards?: jest.Mock;
    mercadoPagoListSavedCards?: jest.Mock;
  }) {
    const profilesRepository = {
      findCustomerProfileByUserId: jest
        .fn()
        .mockResolvedValue(
          options?.profile === undefined
            ? { id: 'profile-1', country: CountryCode.AR }
            : options.profile,
        ),
    } as unknown as ProfilesRepository;

    const isEnabled = jest.fn((key: string) => {
      if (key.includes('rapyd')) {
        return Promise.resolve(options?.rapydEnabled ?? true);
      }
      return Promise.resolve(options?.mercadoPagoEnabled ?? true);
    });
    const platformSettingPort = {
      isEnabled,
    } as unknown as PlatformSettingPort;

    const rapydFind = options?.linkError
      ? jest.fn().mockRejectedValue(options.linkError)
      : jest
          .fn()
          .mockResolvedValue(
            options?.rapydLink === undefined
              ? { providerCustomerId: 'cus_rapyd', environment: 'sandbox' }
              : options.rapydLink,
          );
    const rapydCustomerService = {
      find: rapydFind,
    } as unknown as RapydSavedCardsCustomerService;

    const mercadoPagoFind = options?.linkError
      ? jest.fn().mockRejectedValue(options.linkError)
      : jest
          .fn()
          .mockResolvedValue(
            options?.mercadoPagoLink === undefined
              ? { providerCustomerId: 'cus_mp', environment: 'sandbox' }
              : options.mercadoPagoLink,
          );
    const mercadoPagoCustomerService = {
      find: mercadoPagoFind,
    } as unknown as MercadoPagoSavedCardsCustomerService;

    const rapydListSavedCards =
      options?.rapydListSavedCards ?? jest.fn().mockResolvedValue([RAPYD_CARD]);
    const mercadoPagoListSavedCards =
      options?.mercadoPagoListSavedCards ??
      jest.fn().mockResolvedValue([MERCADOPAGO_CARD]);
    const savedCards = jest.fn((method: PaymentMethod) =>
      method === PaymentMethod.MERCADOPAGO
        ? { listSavedCards: mercadoPagoListSavedCards }
        : { listSavedCards: rapydListSavedCards },
    );
    const registry = {
      savedCards,
    } as unknown as PaymentProviderRegistry;

    const rapydSynced = [{ id: 'saved-rapyd', lastFour: '1111' }];
    const mercadoPagoSynced = [{ id: 'saved-mp', lastFour: '2222' }];
    const syncCards = jest.fn((_profileId: string, method: PaymentMethod) =>
      Promise.resolve(
        method === PaymentMethod.MERCADOPAGO ? mercadoPagoSynced : rapydSynced,
      ),
    );
    const listCards = jest.fn().mockResolvedValue([{ id: 'stale-1' }]);
    const savedCardRepository = {
      syncCards,
      listCards,
    } as unknown as SavedCardRepository;

    return {
      service: new ListMySavedCardsService(
        profilesRepository,
        registry,
        platformSettingPort,
        rapydCustomerService,
        mercadoPagoCustomerService,
        savedCardRepository,
      ),
      isEnabled,
      rapydFind,
      mercadoPagoFind,
      rapydListSavedCards,
      mercadoPagoListSavedCards,
      syncCards,
      listCards,
      rapydSynced,
      mercadoPagoSynced,
    };
  }

  it("mirrors BOTH providers' vaults into the local table and returns the merged, synced list", async () => {
    const m = makeService();

    const cards = await m.service.listMySavedCards('user-1');

    expect(m.rapydListSavedCards).toHaveBeenCalledWith('cus_rapyd');
    expect(m.mercadoPagoListSavedCards).toHaveBeenCalledWith(
      'cus_mp',
      CountryCode.AR,
    );
    expect(m.syncCards).toHaveBeenCalledWith(
      'profile-1',
      PaymentMethod.RAPYD,
      'sandbox',
      [RAPYD_CARD],
    );
    expect(m.syncCards).toHaveBeenCalledWith(
      'profile-1',
      PaymentMethod.MERCADOPAGO,
      'sandbox',
      [MERCADOPAGO_CARD],
    );
    expect(cards).toEqual([...m.rapydSynced, ...m.mercadoPagoSynced]);
  });

  it('Rapyd cards are silently excluded while Rapyd’s OWN saved-cards switch is off — not an error (unchanged)', async () => {
    const m = makeService({ rapydEnabled: false });

    const cards = await m.service.listMySavedCards('user-1');

    expect(m.rapydFind).not.toHaveBeenCalled();
    expect(m.rapydListSavedCards).not.toHaveBeenCalled();
    expect(cards).toEqual(m.mercadoPagoSynced);
  });

  it('Mercado Pago cards stay LISTED while its saved-cards switch is off — the Customer can still see (and erase) what they own', async () => {
    const m = makeService({ mercadoPagoEnabled: false });

    const cards = await m.service.listMySavedCards('user-1');

    expect(m.mercadoPagoListSavedCards).toHaveBeenCalledWith(
      'cus_mp',
      CountryCode.AR,
    );
    expect(cards).toEqual([...m.rapydSynced, ...m.mercadoPagoSynced]);
  });

  it('a country without Mercado Pago credentials just has no Mercado Pago cards — the Rapyd list is not broken', async () => {
    const m = makeService();
    m.mercadoPagoFind.mockRejectedValue(
      new PaymentProviderNotConfiguredError('access token missing'),
    );

    await expect(m.service.listMySavedCards('user-1')).resolves.toEqual(
      m.rapydSynced,
    );
  });

  it('an unconfigured Rapyd (switches ON, no credentials) never hides the Customer’s Mercado Pago cards', async () => {
    const m = makeService();
    m.rapydFind.mockRejectedValue(
      new PaymentProviderNotConfiguredError('access key missing'),
    );

    await expect(m.service.listMySavedCards('user-1')).resolves.toEqual(
      m.mercadoPagoSynced,
    );
  });

  it('a Customer with no Rapyd customer has no Rapyd cards — and Rapyd is not called for listing', async () => {
    const m = makeService({ rapydLink: null });

    const cards = await m.service.listMySavedCards('user-1');

    expect(m.rapydListSavedCards).not.toHaveBeenCalled();
    expect(cards).toEqual(m.mercadoPagoSynced);
  });

  it('a caller without a Customer profile gets an empty list', async () => {
    const m = makeService({ profile: null });

    await expect(m.service.listMySavedCards('user-1')).resolves.toEqual([]);
  });

  it("if Mercado Pago cannot be reached the LAST SYNCED list is returned for IT ONLY — a Mercado Pago outage must never hide the Customer's Rapyd cards", async () => {
    const m = makeService({
      mercadoPagoListSavedCards: jest
        .fn()
        .mockRejectedValue(new PaymentProviderUnavailableError('HTTP 503')),
    });

    const cards = await m.service.listMySavedCards('user-1');

    expect(cards).toEqual([...m.rapydSynced, { id: 'stale-1' }]);
    expect(m.listCards).toHaveBeenCalledWith(
      'profile-1',
      PaymentMethod.MERCADOPAGO,
      'sandbox',
    );
  });

  it('with NO provider configured the list is simply empty — never an error', async () => {
    const m = makeService({
      linkError: new PaymentProviderNotConfiguredError('access key missing'),
    });

    await expect(m.service.listMySavedCards('user-1')).resolves.toEqual([]);
  });
});
