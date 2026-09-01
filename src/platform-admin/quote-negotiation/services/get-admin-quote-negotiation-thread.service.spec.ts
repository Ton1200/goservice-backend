import { QuotesRepository } from '../../../quotes/quotes.repository';
import { QuoteNegotiationRepository } from '../../../quote-negotiation/quote-negotiation.repository';
import { GetAdminQuoteNegotiationThreadService } from './get-admin-quote-negotiation-thread.service';

describe('GetAdminQuoteNegotiationThreadService', () => {
  function makeService(overrides?: { quote?: { id: string } | null }) {
    const quote =
      overrides?.quote === undefined ? { id: 'quote-1' } : overrides.quote;
    const findById = jest.fn().mockResolvedValue(quote);
    const quotesRepository = { findById } as unknown as QuotesRepository;

    const messages = [
      {
        id: 'message-1',
        quoteId: 'quote-1',
        message: 'Te propongo un precio menor.',
        priceProposal: { id: 'proposal-1', proposedPrice: 4500 },
      },
    ];
    const findMessagesByQuoteId = jest.fn().mockResolvedValue(messages);
    const quoteNegotiationRepository = {
      findMessagesByQuoteId,
    } as unknown as QuoteNegotiationRepository;

    const service = new GetAdminQuoteNegotiationThreadService(
      quotesRepository,
      quoteNegotiationRepository,
    );

    return { service, findById, findMessagesByQuoteId, messages };
  }

  it('returns the full, unredacted thread (including the real proposedPrice, never masked) for an existing Quote — this is the admin-schema surface `QUOTE_NEGOTIATION_READ` gates; the permission check itself is enforced generically by AdminPermissionsGuard/RequireAdminPermissions, exercised in admin-permissions.guard.spec.ts', async () => {
    const { service, findMessagesByQuoteId, messages } = makeService();

    const result = await service.getThread('quote-1');

    expect(findMessagesByQuoteId).toHaveBeenCalledWith('quote-1');
    expect(result).toBe(messages);
    expect(result[0].priceProposal?.proposedPrice).toBe(4500);
  });

  it('throws ADMIN_QUOTE_NOT_FOUND for a nonexistent Quote', async () => {
    const { service, findMessagesByQuoteId } = makeService({ quote: null });

    await expect(service.getThread('nope')).rejects.toMatchObject({
      code: 'ADMIN_QUOTE_NOT_FOUND',
    });
    expect(findMessagesByQuoteId).not.toHaveBeenCalled();
  });
});
