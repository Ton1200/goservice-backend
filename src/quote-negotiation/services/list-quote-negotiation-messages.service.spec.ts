import { QuoteNegotiationAccessService } from '../quote-negotiation-access.service';
import { QuoteNegotiationRepository } from '../quote-negotiation.repository';
import { ListQuoteNegotiationMessagesService } from './list-quote-negotiation-messages.service';

describe('ListQuoteNegotiationMessagesService', () => {
  function makeService(overrides?: { resolvePartyRejects?: Error }) {
    const resolveParty = overrides?.resolvePartyRejects
      ? jest.fn().mockRejectedValue(overrides.resolvePartyRejects)
      : jest.fn().mockResolvedValue({ role: 'CUSTOMER' });
    const accessService = {
      resolveParty,
    } as unknown as QuoteNegotiationAccessService;

    const messages = [
      { id: 'message-1', quoteId: 'quote-1' },
      { id: 'message-2', quoteId: 'quote-1' },
    ];
    const findMessagesByQuoteId = jest.fn().mockResolvedValue(messages);
    const quoteNegotiationRepository = {
      findMessagesByQuoteId,
    } as unknown as QuoteNegotiationRepository;

    const service = new ListQuoteNegotiationMessagesService(
      accessService,
      quoteNegotiationRepository,
    );

    return { service, resolveParty, findMessagesByQuoteId, messages };
  }

  it('returns the thread for a caller who is a party to the Quote', async () => {
    const { service, resolveParty, findMessagesByQuoteId, messages } =
      makeService();

    const result = await service.listMessages('user-1', 'quote-1');

    expect(resolveParty).toHaveBeenCalledWith('user-1', 'quote-1');
    expect(findMessagesByQuoteId).toHaveBeenCalledWith('quote-1');
    expect(result).toBe(messages);
  });

  it('blocks a third party (neither Customer nor Professional on this Quote) from reading — QUOTE_NOT_FOUND, propagated from QuoteNegotiationAccessService, and the repository is never queried', async () => {
    const { service, findMessagesByQuoteId } = makeService({
      resolvePartyRejects: Object.assign(new Error('Quote not found.'), {
        code: 'QUOTE_NOT_FOUND',
      }),
    });

    await expect(
      service.listMessages('third-party-user', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
    expect(findMessagesByQuoteId).not.toHaveBeenCalled();
  });
});
