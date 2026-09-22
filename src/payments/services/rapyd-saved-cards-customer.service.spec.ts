import { Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { UsersRepository } from '../../users/users.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { SavedCardRepository } from '../saved-card.repository';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';

const PROFILE = { id: 'profile-1', firstName: 'Ana', lastName: 'Paz' } as never;

describe('RapydSavedCardsCustomerService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterAll(() => jest.restoreAllMocks());

  function makeService(options?: {
    existing?: Record<string, unknown> | null;
  }) {
    const createCustomer = jest
      .fn()
      .mockResolvedValue({ customerId: 'cus_new' });
    const currentEnvironment = jest.fn().mockResolvedValue('sandbox');
    const registry = {
      savedCards: jest
        .fn()
        .mockReturnValue({ createCustomer, currentEnvironment }),
    } as unknown as PaymentProviderRegistry;
    const findProviderCustomer = jest
      .fn()
      .mockResolvedValue(options?.existing ?? null);
    const createProviderCustomer = jest
      .fn()
      .mockResolvedValue({ providerCustomerId: 'cus_new' });
    const savedCardRepository = {
      findProviderCustomer,
      createProviderCustomer,
    } as unknown as SavedCardRepository;
    const usersRepository = {
      findById: jest.fn().mockResolvedValue({ email: 'ana@example.com' }),
    } as unknown as UsersRepository;
    return {
      service: new RapydSavedCardsCustomerService(
        registry,
        savedCardRepository,
        usersRepository,
      ),
      createCustomer,
      findProviderCustomer,
      createProviderCustomer,
    };
  }

  it('`find` never creates anything: it only looks the link up for the CURRENT environment', async () => {
    const m = makeService({ existing: { providerCustomerId: 'cus_1' } });

    await expect(m.service.find('profile-1')).resolves.toEqual({
      providerCustomerId: 'cus_1',
      environment: 'sandbox',
    });
    expect(m.findProviderCustomer).toHaveBeenCalledWith(
      'profile-1',
      PaymentMethod.RAPYD,
      'sandbox',
    );
    expect(m.createCustomer).not.toHaveBeenCalled();
    await expect(makeService().service.find('profile-1')).resolves.toBeNull();
  });

  it('`ensure` reuses an existing Rapyd customer — the same person is the same Rapyd customer on every payment', async () => {
    const m = makeService({ existing: { providerCustomerId: 'cus_1' } });

    await expect(m.service.ensure(PROFILE, 'user-1')).resolves.toEqual({
      providerCustomerId: 'cus_1',
      environment: 'sandbox',
    });
    expect(m.createCustomer).not.toHaveBeenCalled();
  });

  it('`ensure` creates the Rapyd customer with ONLY a name, an email and the profile id, and stores the link with the environment', async () => {
    const m = makeService();

    const link = await m.service.ensure(PROFILE, 'user-1');

    expect(m.createCustomer).toHaveBeenCalledWith({
      name: 'Ana Paz',
      email: 'ana@example.com',
      externalReference: 'profile-1',
    });
    expect(m.createProviderCustomer).toHaveBeenCalledWith({
      customerProfileId: 'profile-1',
      method: PaymentMethod.RAPYD,
      environment: 'sandbox',
      providerCustomerId: 'cus_new',
    });
    expect(link).toEqual({
      providerCustomerId: 'cus_new',
      environment: 'sandbox',
    });
  });
});
