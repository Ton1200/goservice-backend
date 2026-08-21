import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { ListEligibleServiceRequestCustomersService } from './list-eligible-service-request-customers.service';

describe('ListEligibleServiceRequestCustomersService', () => {
  const row = {
    id: 'customer-profile-1',
    displayName: 'Juan Perez',
    user: {
      id: 'user-1',
      email: 'juan@example.com',
      firstName: 'Juan',
      lastName: 'Perez',
    },
  };

  function makeService() {
    const findApprovedCustomerProfilesForAdmin = jest
      .fn()
      .mockResolvedValue([row]);
    const profilesRepository = {
      findApprovedCustomerProfilesForAdmin,
    } as unknown as ProfilesRepository;

    const service = new ListEligibleServiceRequestCustomersService(
      profilesRepository,
    );

    return { service, findApprovedCustomerProfilesForAdmin };
  }

  it('maps rows into AdminServiceRequestCustomer shape', async () => {
    const { service } = makeService();

    const result = await service.listEligibleCustomers();

    expect(result).toEqual([
      {
        id: 'customer-profile-1',
        userId: 'user-1',
        displayName: 'Juan Perez',
        email: 'juan@example.com',
        firstName: 'Juan',
        lastName: 'Perez',
      },
    ]);
  });

  it('forwards the search string to the repository', async () => {
    const { service, findApprovedCustomerProfilesForAdmin } = makeService();

    await service.listEligibleCustomers('juan');

    expect(findApprovedCustomerProfilesForAdmin).toHaveBeenCalledWith('juan');
  });
});
