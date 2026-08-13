import { UsersRepository } from '../../../users/users.repository';
import { ListUserAccountsService } from './list-user-accounts.service';

describe('ListUserAccountsService', () => {
  function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phoneCountryCode: '+54',
      phoneNumber: '91122334455',
      accountStatus: 'EMAIL_VERIFIED',
      authProvider: 'PASSWORD',
      createdAt: new Date(),
      updatedAt: new Date(),
      customerProfile: null,
      professionalProfile: null,
      ...overrides,
    };
  }

  function makeService(rows: unknown[], totalCount: number) {
    const findManyForAdmin = jest.fn().mockResolvedValue(rows);
    const countAllForAdmin = jest.fn().mockResolvedValue(totalCount);
    const usersRepository = {
      findManyForAdmin,
      countAllForAdmin,
    } as unknown as UsersRepository;
    return {
      service: new ListUserAccountsService(usersRepository),
      findManyForAdmin,
    };
  }

  it('maps rows to UserAccountModel, deriving hasCustomerProfile/hasProfessionalProfile from presence', async () => {
    const { service } = makeService(
      [
        makeRow({ customerProfile: { id: 'cp1' }, professionalProfile: null }),
        makeRow({
          id: 'u2',
          customerProfile: null,
          professionalProfile: { id: 'pp1' },
        }),
      ],
      2,
    );

    const page = await service.listUserAccounts();

    expect(page.items[0].hasCustomerProfile).toBe(true);
    expect(page.items[0].hasProfessionalProfile).toBe(false);
    expect(page.items[1].hasCustomerProfile).toBe(false);
    expect(page.items[1].hasProfessionalProfile).toBe(true);
    expect(page.totalCount).toBe(2);
  });

  it('defaults limit and clamps it to the max page size', async () => {
    const { service, findManyForAdmin } = makeService([], 0);

    await service.listUserAccounts(9999, 0);

    expect(findManyForAdmin).toHaveBeenCalledWith({ limit: 200, offset: 0 });
  });

  it('defaults offset to 0 when not provided', async () => {
    const { service, findManyForAdmin } = makeService([], 0);

    await service.listUserAccounts();

    expect(findManyForAdmin).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });
});
