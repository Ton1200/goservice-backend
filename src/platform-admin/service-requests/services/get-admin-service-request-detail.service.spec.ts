import { ServiceRequestsRepository } from '../../../service-requests/service-requests.repository';
import { GetAdminServiceRequestDetailService } from './get-admin-service-request-detail.service';

describe('GetAdminServiceRequestDetailService', () => {
  const row = {
    id: 'service-request-1',
    description: 'Se rompió una cañería.',
    urgency: 'URGENT',
    indicativeBudgetMin: 100,
    indicativeBudgetMax: 500,
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
      displayName: 'Juan Perez',
      user: {
        id: 'user-1',
        email: 'juan@example.com',
        firstName: 'Juan',
        lastName: 'Perez',
      },
    },
    attachments: [
      { id: 'attachment-1', url: 'http://x/a', createdAt: new Date() },
    ],
  };

  function makeService(overrides?: { row?: typeof row | null }) {
    const findByIdForAdmin = jest
      .fn()
      .mockResolvedValue(overrides?.row === undefined ? row : overrides.row);
    const serviceRequestsRepository = {
      findByIdForAdmin,
    } as unknown as ServiceRequestsRepository;

    const service = new GetAdminServiceRequestDetailService(
      serviceRequestsRepository,
    );

    return { service, findByIdForAdmin };
  }

  it('returns the full detail, including attachments and the owning customer', async () => {
    const { service } = makeService();

    const detail = await service.getServiceRequestDetail('service-request-1');

    expect(detail).toMatchObject({
      id: 'service-request-1',
      attachments: [expect.objectContaining({ id: 'attachment-1' })],
      customer: { userId: 'user-1', email: 'juan@example.com' },
    });
  });

  it('throws ADMIN_SERVICE_REQUEST_NOT_FOUND for a nonexistent id', async () => {
    const { service } = makeService({ row: null });

    await expect(
      service.getServiceRequestDetail('nonexistent'),
    ).rejects.toMatchObject({ code: 'ADMIN_SERVICE_REQUEST_NOT_FOUND' });
  });
});
