import { Logger } from '@nestjs/common';
import { CountryCode, PaymentMethod } from '@prisma/client';
import { UsersRepository } from '../../users/users.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { SavedCardRepository } from '../saved-card.repository';
import { MercadoPagoSavedCardsCustomerService } from './mercadopago-saved-cards-customer.service';

const PROFILE = { id: 'profile-1', firstName: 'Ana', lastName: 'Paz' } as never;

describe('MercadoPagoSavedCardsCustomerService', () => {
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
      service: new MercadoPagoSavedCardsCustomerService(
        registry,
        savedCardRepository,
        usersRepository,
      ),
      createCustomer,
      currentEnvironment,
      findProviderCustomer,
      createProviderCustomer,
    };
  }

  it('`find` never creates anything: it only looks the link up for the CURRENT environment of the given country', async () => {
    const m = makeService({ existing: { providerCustomerId: 'cus_1' } });

    await expect(m.service.find('profile-1', CountryCode.AR)).resolves.toEqual({
      providerCustomerId: 'cus_1',
      environment: 'sandbox',
    });
    expect(m.currentEnvironment).toHaveBeenCalledWith(CountryCode.AR);
    expect(m.findProviderCustomer).toHaveBeenCalledWith(
      'profile-1',
      PaymentMethod.MERCADOPAGO,
      'sandbox',
    );
    expect(m.createCustomer).not.toHaveBeenCalled();
    await expect(
      makeService().service.find('profile-1', CountryCode.AR),
    ).resolves.toBeNull();
  });

  it('`ensure` reuses an existing Mercado Pago customer — the same person is the same Mercado Pago customer on every payment', async () => {
    const m = makeService({ existing: { providerCustomerId: 'cus_1' } });

    await expect(
      m.service.ensure(PROFILE, 'user-1', CountryCode.AR),
    ).resolves.toEqual({
      providerCustomerId: 'cus_1',
      environment: 'sandbox',
    });
    expect(m.createCustomer).not.toHaveBeenCalled();
  });

  it('`ensure` creates the Mercado Pago customer with a name, an email, the profile id AND the country, and stores the link with the environment', async () => {
    const m = makeService();

    const link = await m.service.ensure(PROFILE, 'user-1', CountryCode.AR);

    expect(m.createCustomer).toHaveBeenCalledWith({
      name: 'Ana Paz',
      email: 'ana@example.com',
      externalReference: 'profile-1',
      country: CountryCode.AR,
    });
    expect(m.createProviderCustomer).toHaveBeenCalledWith({
      customerProfileId: 'profile-1',
      method: PaymentMethod.MERCADOPAGO,
      environment: 'sandbox',
      providerCustomerId: 'cus_new',
    });
    expect(link).toEqual({
      providerCustomerId: 'cus_new',
      environment: 'sandbox',
    });
  });
});
