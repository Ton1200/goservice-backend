import { Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  ProviderSavedCard,
} from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { ListMySavedCardsService } from './list-my-saved-cards.service';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';

const PROVIDER_CARD: ProviderSavedCard = {
  providerCardId: 'card_1',
  brand: 'visa',
  lastFour: '1111',
  type: 'debit_card',
  expirationMonth: 12,
  expirationYear: 2030,
};

describe('ListMySavedCardsService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  function makeService(options?: {
    profile?: Record<string, unknown> | null;
    link?: { providerCustomerId: string; environment: string } | null;
    linkError?: Error;
    listSavedCards?: jest.Mock;
  }) {
    const profilesRepository = {
      findCustomerProfileByUserId: jest
        .fn()
        .mockResolvedValue(
          options?.profile === undefined
            ? { id: 'profile-1' }
            : options.profile,
        ),
    } as unknown as ProfilesRepository;
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
    const listSavedCards =
      options?.listSavedCards ?? jest.fn().mockResolvedValue([PROVIDER_CARD]);
    const registry = {
      savedCards: jest.fn().mockReturnValue({ listSavedCards }),
    } as unknown as PaymentProviderRegistry;
    const synced = [{ id: 'saved-1', lastFour: '1111' }];
    const syncCards = jest.fn().mockResolvedValue(synced);
    const listCards = jest.fn().mockResolvedValue([{ id: 'stale-1' }]);
    const savedCardRepository = {
      syncCards,
      listCards,
    } as unknown as SavedCardRepository;
    return {
      service: new ListMySavedCardsService(
        profilesRepository,
        registry,
        customerService,
        savedCardRepository,
      ),
      listSavedCards,
      syncCards,
      listCards,
      synced,
    };
  }

  it("mirrors Rapyd's vault into the local table and returns the synced list", async () => {
    const m = makeService();

    const cards = await m.service.listMySavedCards('user-1');

    expect(m.listSavedCards).toHaveBeenCalledWith('cus_1');
    expect(m.syncCards).toHaveBeenCalledWith(
      'profile-1',
      PaymentMethod.RAPYD,
      'sandbox',
      [PROVIDER_CARD],
    );
    expect(cards).toBe(m.synced);
  });

  it('a Customer with no Rapyd customer has no cards — and Rapyd is not called', async () => {
    const m = makeService({ link: null });

    await expect(m.service.listMySavedCards('user-1')).resolves.toEqual([]);
    expect(m.listSavedCards).not.toHaveBeenCalled();
  });

  it('a caller without a Customer profile gets an empty list', async () => {
    const m = makeService({ profile: null });

    await expect(m.service.listMySavedCards('user-1')).resolves.toEqual([]);
  });

  it('if Rapyd cannot be reached the LAST SYNCED list is returned — listing must not break because a provider is down', async () => {
    const m = makeService({
      listSavedCards: jest
        .fn()
        .mockRejectedValue(new PaymentProviderUnavailableError('HTTP 503')),
    });

    const cards = await m.service.listMySavedCards('user-1');

    expect(cards).toEqual([{ id: 'stale-1' }]);
    expect(m.listCards).toHaveBeenCalledWith(
      'profile-1',
      PaymentMethod.RAPYD,
      'sandbox',
    );
    expect(m.syncCards).not.toHaveBeenCalled();
  });

  it('missing credentials are PAYMENT_PROVIDER_NOT_CONFIGURED', async () => {
    const m = makeService({
      linkError: new PaymentProviderNotConfiguredError('access key missing'),
    });

    await expect(m.service.listMySavedCards('user-1')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
    });
  });
});
