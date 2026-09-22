import { Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
} from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { DeleteSavedCardService } from './delete-saved-card.service';

const CARD = {
  id: 'saved-1',
  customerProfileId: 'profile-1',
  method: PaymentMethod.RAPYD,
  environment: 'sandbox',
  providerCardId: 'card_1',
};

describe('DeleteSavedCardService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  function makeService(options?: {
    profile?: Record<string, unknown> | null;
    card?: Record<string, unknown> | null;
    environment?: string;
    customer?: Record<string, unknown> | null;
    deleteSavedCard?: jest.Mock;
    currentEnvironment?: jest.Mock;
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
    const findCardOfCustomer = jest
      .fn()
      .mockResolvedValue(options?.card === undefined ? CARD : options.card);
    const findProviderCustomer = jest
      .fn()
      .mockResolvedValue(
        options?.customer === undefined
          ? { providerCustomerId: 'cus_1' }
          : options.customer,
      );
    const deleteCard = jest.fn().mockResolvedValue(undefined);
    const savedCardRepository = {
      findCardOfCustomer,
      findProviderCustomer,
      deleteCard,
    } as unknown as SavedCardRepository;
    const deleteSavedCard =
      options?.deleteSavedCard ?? jest.fn().mockResolvedValue(undefined);
    const currentEnvironment =
      options?.currentEnvironment ??
      jest.fn().mockResolvedValue(options?.environment ?? 'sandbox');
    const registry = {
      savedCards: jest
        .fn()
        .mockReturnValue({ currentEnvironment, deleteSavedCard }),
    } as unknown as PaymentProviderRegistry;
    return {
      service: new DeleteSavedCardService(
        profilesRepository,
        registry,
        savedCardRepository,
      ),
      findCardOfCustomer,
      deleteSavedCard,
      deleteCard,
    };
  }

  it("erases the card from Rapyd's vault FIRST and only then from GoService's table", async () => {
    const m = makeService();

    await m.service.deleteSavedCard('user-1', 'saved-1');

    expect(m.findCardOfCustomer).toHaveBeenCalledWith('saved-1', 'profile-1');
    expect(m.deleteSavedCard).toHaveBeenCalledWith('cus_1', 'card_1');
    expect(m.deleteCard).toHaveBeenCalledWith('saved-1');
    expect(m.deleteSavedCard.mock.invocationCallOrder[0]).toBeLessThan(
      m.deleteCard.mock.invocationCallOrder[0],
    );
  });

  it("a card that does not exist or is not the caller's is SAVED_CARD_NOT_FOUND (indistinguishable) and nothing is touched", async () => {
    const m = makeService({ card: null });

    await expect(
      m.service.deleteSavedCard('user-1', 'saved-1'),
    ).rejects.toMatchObject({ code: 'SAVED_CARD_NOT_FOUND' });
    expect(m.deleteSavedCard).not.toHaveBeenCalled();
    expect(m.deleteCard).not.toHaveBeenCalled();
  });

  it('a caller with no Customer profile gets the same SAVED_CARD_NOT_FOUND', async () => {
    const m = makeService({ profile: null });

    await expect(
      m.service.deleteSavedCard('user-1', 'saved-1'),
    ).rejects.toMatchObject({ code: 'SAVED_CARD_NOT_FOUND' });
  });

  it('if Rapyd cannot delete it the local row is KEPT (never a card that looks deleted but can still be charged) and the error is PAYMENT_PROVIDER_UNAVAILABLE', async () => {
    const m = makeService({
      deleteSavedCard: jest
        .fn()
        .mockRejectedValue(new PaymentProviderUnavailableError('HTTP 503')),
    });

    await expect(
      m.service.deleteSavedCard('user-1', 'saved-1'),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    expect(m.deleteCard).not.toHaveBeenCalled();
  });

  it('missing credentials are PAYMENT_PROVIDER_NOT_CONFIGURED and the row is kept', async () => {
    const m = makeService({
      currentEnvironment: jest
        .fn()
        .mockRejectedValue(new PaymentProviderNotConfiguredError('missing')),
    });

    await expect(
      m.service.deleteSavedCard('user-1', 'saved-1'),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
    expect(m.deleteCard).not.toHaveBeenCalled();
  });

  it("a card of ANOTHER Rapyd environment cannot be removed remotely with today's credentials: it is removed locally only", async () => {
    const m = makeService({ environment: 'production' });

    await m.service.deleteSavedCard('user-1', 'saved-1');

    expect(m.deleteSavedCard).not.toHaveBeenCalled();
    expect(m.deleteCard).toHaveBeenCalledWith('saved-1');
  });
});
