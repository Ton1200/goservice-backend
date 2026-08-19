import { QuotesRepository } from '../../../quotes/quotes.repository';
import { GetAdminQuoteDetailService } from './get-admin-quote-detail.service';

describe('GetAdminQuoteDetailService', () => {
  const baseRow = {
    id: 'quote-1',
    price: 15000,
    message: 'Puedo hacerlo el jueves.',
    status: 'ACCEPTED',
    createdAt: new Date(),
    updatedAt: new Date(),
    serviceRequest: {
      id: 'service-request-1',
      description: 'Se rompió una cañería.',
      status: 'ENGAGED',
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
    },
    professionalProfile: {
      id: 'professional-profile-1',
      displayName: 'Carlos Gomez',
      user: {
        id: 'user-2',
        email: 'carlos@example.com',
        firstName: 'Carlos',
        lastName: 'Gomez',
      },
    },
  };

  function makeService(overrides?: {
    row?: (typeof baseRow & { engagement: unknown }) | null;
  }) {
    const row =
      overrides?.row === undefined
        ? { ...baseRow, engagement: null }
        : overrides.row;
    const findByIdForAdmin = jest.fn().mockResolvedValue(row);
    const quotesRepository = {
      findByIdForAdmin,
    } as unknown as QuotesRepository;

    const service = new GetAdminQuoteDetailService(quotesRepository);

    return { service, findByIdForAdmin };
  }

  it('returns the full detail, including the serviceRequest/professional relations, with engagement null when none exists', async () => {
    const { service } = makeService();

    const detail = await service.getQuoteDetail('quote-1');

    expect(detail).toMatchObject({
      id: 'quote-1',
      status: 'ACCEPTED',
      serviceRequest: { id: 'service-request-1' },
      professional: { userId: 'user-2', email: 'carlos@example.com' },
      engagement: null,
    });
  });

  it('includes the linked Engagement when this Quote was accepted', async () => {
    const engagement = {
      id: 'engagement-1',
      status: 'ACCEPTED',
      createdAt: new Date(),
    };
    const { service } = makeService({
      row: { ...baseRow, engagement },
    });

    const detail = await service.getQuoteDetail('quote-1');

    expect(detail.engagement).toMatchObject({ id: 'engagement-1' });
  });

  it('throws ADMIN_QUOTE_NOT_FOUND for a nonexistent id', async () => {
    const { service } = makeService({ row: null });

    await expect(service.getQuoteDetail('nonexistent')).rejects.toMatchObject({
      code: 'ADMIN_QUOTE_NOT_FOUND',
    });
  });
});
