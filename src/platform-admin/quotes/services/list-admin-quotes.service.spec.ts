import { QuotesRepository } from '../../../quotes/quotes.repository';
import { ListAdminQuotesService } from './list-admin-quotes.service';

describe('ListAdminQuotesService', () => {
  const row = {
    id: 'quote-1',
    price: 15000,
    message: 'Puedo hacerlo el jueves.',
    status: 'SENT',
    createdAt: new Date(),
    updatedAt: new Date(),
    serviceRequest: {
      id: 'service-request-1',
      description: 'Se rompió una cañería.',
      status: 'OPEN',
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

  function makeService() {
    const findManyForAdmin = jest.fn().mockResolvedValue([row]);
    const countAllForAdmin = jest.fn().mockResolvedValue(1);
    const quotesRepository = {
      findManyForAdmin,
      countAllForAdmin,
    } as unknown as QuotesRepository;

    const service = new ListAdminQuotesService(quotesRepository);

    return { service, findManyForAdmin, countAllForAdmin };
  }

  it('maps rows into AdminQuoteModel shape, including the serviceRequest/professional relations', async () => {
    const { service } = makeService();

    const page = await service.listQuotes();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'quote-1',
      status: 'SENT',
      serviceRequest: {
        id: 'service-request-1',
        customerProfile: { userId: 'user-1', email: 'juan@example.com' },
      },
      professional: { userId: 'user-2', email: 'carlos@example.com' },
    });
    expect(page.totalCount).toBe(1);
  });

  it('clamps limit to the server-enforced max and defaults offset to 0', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listQuotes(9999, -5);

    expect(findManyForAdmin).toHaveBeenCalledWith({ limit: 200, offset: 0 });
  });

  it('applies the default limit when none is given', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listQuotes();

    expect(findManyForAdmin).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });
});
