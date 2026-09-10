import { ServiceRequestsRepository } from '../../../service-requests/service-requests.repository';
import { ListAdminServiceRequestsService } from './list-admin-service-requests.service';

describe('ListAdminServiceRequestsService', () => {
  const row = {
    id: 'service-request-1',
    description: 'Se rompió una cañería.',
    urgency: 'URGENT',
    indicativeBudgetMin: null,
    indicativeBudgetMax: null,
    status: 'OPEN',
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: {
      id: 'cat-1',
      name: 'Plomería',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    customerProfile: {
      id: 'customer-profile-1',
      firstName: 'Juan',
      lastName: 'Perez',
      user: {
        id: 'user-1',
        email: 'juan@example.com',
      },
    },
    _count: { attachments: 2 },
  };

  function makeService() {
    const findManyForAdmin = jest.fn().mockResolvedValue([row]);
    const countAllForAdmin = jest.fn().mockResolvedValue(1);
    const serviceRequestsRepository = {
      findManyForAdmin,
      countAllForAdmin,
    } as unknown as ServiceRequestsRepository;

    const service = new ListAdminServiceRequestsService(
      serviceRequestsRepository,
    );

    return { service, findManyForAdmin, countAllForAdmin };
  }

  it('maps rows into AdminServiceRequestModel shape, including the customer relation', async () => {
    const { service } = makeService();

    const page = await service.listServiceRequests();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'service-request-1',
      status: 'OPEN',
      attachmentsCount: 2,
      customer: {
        id: 'customer-profile-1',
        userId: 'user-1',
        firstName: 'Juan',
        lastName: 'Perez',
        email: 'juan@example.com',
      },
    });
    expect(page.totalCount).toBe(1);
  });

  it('clamps limit to the server-enforced max and defaults offset to 0', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listServiceRequests(9999, -5);

    expect(findManyForAdmin).toHaveBeenCalledWith({ limit: 200, offset: 0 });
  });

  it('applies the default limit when none is given', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listServiceRequests();

    expect(findManyForAdmin).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });
});
