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
    quotes: [
      {
        id: 'quote-1',
        price: 15000,
        negotiatedPrice: 14000,
        status: 'SENT',
        createdAt: new Date(),
        professionalProfile: {
          displayName: 'Carlos Gomez',
          user: { email: 'carlos@example.com' },
        },
        _count: { negotiationMessages: 3 },
      },
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
      quotes: [
        {
          id: 'quote-1',
          price: 15000,
          negotiatedPrice: 14000,
          finalPrice: 14000,
          status: 'SENT',
          negotiationMessageCount: 3,
          professional: {
            displayName: 'Carlos Gomez',
            email: 'carlos@example.com',
          },
        },
      ],
    });
  });

  it("a nested quote's finalPrice falls back to price when there is no negotiatedPrice", async () => {
    const { service } = makeService({
      row: {
        ...row,
        quotes: [{ ...row.quotes[0], negotiatedPrice: null }],
      },
    });

    const detail = await service.getServiceRequestDetail('service-request-1');

    expect(detail.quotes[0]).toMatchObject({
      price: 15000,
      negotiatedPrice: null,
      finalPrice: 15000,
    });
  });

  it('throws ADMIN_SERVICE_REQUEST_NOT_FOUND for a nonexistent id', async () => {
    const { service } = makeService({ row: null });

    await expect(
      service.getServiceRequestDetail('nonexistent'),
    ).rejects.toMatchObject({ code: 'ADMIN_SERVICE_REQUEST_NOT_FOUND' });
  });
});
