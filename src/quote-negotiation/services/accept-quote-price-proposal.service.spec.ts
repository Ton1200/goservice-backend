import { Logger } from '@nestjs/common';
import {
  QuoteNegotiationParty,
  QuotePriceProposalStatus,
  QuoteStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotesRepository } from '../../quotes/quotes.repository';
import {
  QuoteNegotiationAccessService,
  QuoteNegotiationPartyResolution,
} from '../quote-negotiation-access.service';
import { QuoteNegotiationRepository } from '../quote-negotiation.repository';
import { AcceptQuotePriceProposalService } from './accept-quote-price-proposal.service';

describe('AcceptQuotePriceProposalService', () => {
  function makeProposal(
    overrides?: Partial<{
      status: QuotePriceProposalStatus;
      proposedByRole: QuoteNegotiationParty;
      proposedPrice: number;
    }>,
  ) {
    return {
      id: 'proposal-1',
      quoteId: 'quote-1',
      proposedByRole:
        overrides?.proposedByRole ?? QuoteNegotiationParty.PROFESSIONAL,
      proposedPrice: overrides?.proposedPrice ?? 5000,
      status: overrides?.status ?? QuotePriceProposalStatus.PENDING,
    };
  }

  function makeParty(
    overrides?: Partial<QuoteNegotiationPartyResolution>,
  ): QuoteNegotiationPartyResolution {
    return {
      role: QuoteNegotiationParty.CUSTOMER,
      quote: { id: 'quote-1', status: QuoteStatus.SENT } as never,
      serviceRequest: { id: 'service-request-1' } as never,
      customerProfileId: 'customer-profile-1',
      professionalProfileId: null,
      ...overrides,
    };
  }

  function makeService(overrides?: {
    proposal?: ReturnType<typeof makeProposal> | null;
    party?: QuoteNegotiationPartyResolution | null;
    casCount?: number;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const proposal =
      overrides?.proposal === undefined ? makeProposal() : overrides.proposal;
    const findProposalById = jest.fn().mockResolvedValue(proposal);
    const acceptProposal = jest
      .fn()
      .mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const quoteNegotiationRepository = {
      findProposalById,
      acceptProposal,
    } as unknown as QuoteNegotiationRepository;

    const tryResolveParty = jest
      .fn()
      .mockResolvedValue(
        overrides?.party === undefined ? makeParty() : overrides.party,
      );
    const accessService = {
      tryResolveParty,
    } as unknown as QuoteNegotiationAccessService;

    const setNegotiatedPrice = jest.fn().mockResolvedValue({ id: 'quote-1' });
    const findById = jest.fn().mockResolvedValue({
      id: 'quote-1',
      price: 4500,
      negotiatedPrice: proposal?.proposedPrice ?? null,
      status: QuoteStatus.SENT,
    });
    const quotesRepository = {
      setNegotiatedPrice,
      findById,
    } as unknown as QuotesRepository;

    const service = new AcceptQuotePriceProposalService(
      prisma,
      accessService,
      quoteNegotiationRepository,
      quotesRepository,
    );

    return {
      service,
      findProposalById,
      tryResolveParty,
      acceptProposal,
      setNegotiatedPrice,
      findById,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("accepts the counterparty's PENDING proposal: CAS PENDING->ACCEPTED, then sets Quote.negotiatedPrice — Quote.price is never touched", async () => {
    const { service, acceptProposal, setNegotiatedPrice } = makeService();

    const result = await service.accept('user-1', 'proposal-1');

    expect(acceptProposal).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'proposal-1',
      {
        resolvedByCustomerProfileId: 'customer-profile-1',
        resolvedByProfessionalProfileId: null,
      },
    );
    expect(setNegotiatedPrice).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'quote-1',
      5000,
    );
    expect(result.price).toBe(4500); // original price, untouched
    expect(result.negotiatedPrice).toBe(5000);
  });

  it('throws QUOTE_PRICE_PROPOSAL_SELF_RESOLVE_FORBIDDEN when the caller is the proposal author', async () => {
    const { service, acceptProposal } = makeService({
      party: makeParty({ role: QuoteNegotiationParty.PROFESSIONAL }),
      proposal: makeProposal({
        proposedByRole: QuoteNegotiationParty.PROFESSIONAL,
      }),
    });

    await expect(service.accept('user-1', 'proposal-1')).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_SELF_RESOLVE_FORBIDDEN',
    });
    expect(acceptProposal).not.toHaveBeenCalled();
  });

  it('throws QUOTE_NOT_NEGOTIABLE when the Quote is not SENT', async () => {
    const { service } = makeService({
      party: makeParty({
        quote: { id: 'quote-1', status: QuoteStatus.ACCEPTED } as never,
      }),
    });

    await expect(service.accept('user-1', 'proposal-1')).rejects.toMatchObject({
      code: 'QUOTE_NOT_NEGOTIABLE',
    });
  });

  it('throws QUOTE_PRICE_PROPOSAL_NOT_PENDING when the proposal is no longer PENDING', async () => {
    const { service } = makeService({
      proposal: makeProposal({ status: QuotePriceProposalStatus.SUPERSEDED }),
    });

    await expect(service.accept('user-1', 'proposal-1')).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_NOT_PENDING',
    });
  });

  it('throws QUOTE_PRICE_PROPOSAL_NOT_FOUND for a nonexistent proposal', async () => {
    const { service, tryResolveParty } = makeService({ proposal: null });

    await expect(service.accept('user-1', 'nope')).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_NOT_FOUND',
    });
    expect(tryResolveParty).not.toHaveBeenCalled();
  });

  it('throws QUOTE_PRICE_PROPOSAL_NOT_FOUND (same code) for a third party not on this Quote', async () => {
    const { service } = makeService({ party: null });

    await expect(
      service.accept('third-party-user', 'proposal-1'),
    ).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_NOT_FOUND',
    });
  });

  it('throws QUOTE_PRICE_PROPOSAL_RESOLVE_CONFLICT when the CAS loses a race', async () => {
    const { service, setNegotiatedPrice } = makeService({ casCount: 0 });

    await expect(service.accept('user-1', 'proposal-1')).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_RESOLVE_CONFLICT',
    });
    expect(setNegotiatedPrice).not.toHaveBeenCalled();
  });
});
