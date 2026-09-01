import { Logger } from '@nestjs/common';
import {
  QuoteNegotiationParty,
  QuotePriceProposalStatus,
  QuoteStatus,
} from '@prisma/client';
import {
  QuoteNegotiationAccessService,
  QuoteNegotiationPartyResolution,
} from '../quote-negotiation-access.service';
import { QuoteNegotiationRepository } from '../quote-negotiation.repository';
import { RejectQuotePriceProposalService } from './reject-quote-price-proposal.service';

describe('RejectQuotePriceProposalService', () => {
  function makeProposal(
    overrides?: Partial<{
      status: QuotePriceProposalStatus;
      proposedByRole: QuoteNegotiationParty;
    }>,
  ) {
    return {
      id: 'proposal-1',
      quoteId: 'quote-1',
      proposedByRole:
        overrides?.proposedByRole ?? QuoteNegotiationParty.PROFESSIONAL,
      proposedPrice: 5000,
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
    const proposal =
      overrides?.proposal === undefined ? makeProposal() : overrides.proposal;
    const rejected = proposal
      ? { ...proposal, status: QuotePriceProposalStatus.REJECTED }
      : null;
    const findProposalById = jest
      .fn()
      .mockResolvedValueOnce(proposal)
      .mockResolvedValueOnce(rejected);
    const rejectProposal = jest
      .fn()
      .mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const quoteNegotiationRepository = {
      findProposalById,
      rejectProposal,
    } as unknown as QuoteNegotiationRepository;

    const tryResolveParty = jest
      .fn()
      .mockResolvedValue(
        overrides?.party === undefined ? makeParty() : overrides.party,
      );
    const accessService = {
      tryResolveParty,
    } as unknown as QuoteNegotiationAccessService;

    const service = new RejectQuotePriceProposalService(
      accessService,
      quoteNegotiationRepository,
    );

    return { service, findProposalById, tryResolveParty, rejectProposal };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("rejects the counterparty's PENDING proposal — changes nothing on Quote (no Quote repository is even injected into this service)", async () => {
    const { service, rejectProposal } = makeService();

    const result = await service.reject('user-1', 'proposal-1');

    expect(rejectProposal).toHaveBeenCalledWith('proposal-1', {
      resolvedByCustomerProfileId: 'customer-profile-1',
      resolvedByProfessionalProfileId: null,
    });
    expect(result.status).toBe(QuotePriceProposalStatus.REJECTED);
  });

  it('throws QUOTE_PRICE_PROPOSAL_SELF_RESOLVE_FORBIDDEN when the caller is the proposal author', async () => {
    const { service, rejectProposal } = makeService({
      party: makeParty({ role: QuoteNegotiationParty.PROFESSIONAL }),
      proposal: makeProposal({
        proposedByRole: QuoteNegotiationParty.PROFESSIONAL,
      }),
    });

    await expect(service.reject('user-1', 'proposal-1')).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_SELF_RESOLVE_FORBIDDEN',
    });
    expect(rejectProposal).not.toHaveBeenCalled();
  });

  it('throws QUOTE_NOT_NEGOTIABLE when the Quote is not SENT', async () => {
    const { service } = makeService({
      party: makeParty({
        quote: { id: 'quote-1', status: QuoteStatus.WITHDRAWN } as never,
      }),
    });

    await expect(service.reject('user-1', 'proposal-1')).rejects.toMatchObject({
      code: 'QUOTE_NOT_NEGOTIABLE',
    });
  });

  it('throws QUOTE_PRICE_PROPOSAL_NOT_PENDING when the proposal is no longer PENDING', async () => {
    const { service } = makeService({
      proposal: makeProposal({ status: QuotePriceProposalStatus.ACCEPTED }),
    });

    await expect(service.reject('user-1', 'proposal-1')).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_NOT_PENDING',
    });
  });

  it('throws QUOTE_PRICE_PROPOSAL_NOT_FOUND for a nonexistent proposal', async () => {
    const { service, tryResolveParty } = makeService({ proposal: null });

    await expect(service.reject('user-1', 'nope')).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_NOT_FOUND',
    });
    expect(tryResolveParty).not.toHaveBeenCalled();
  });

  it('throws QUOTE_PRICE_PROPOSAL_NOT_FOUND (same code) for a third party not on this Quote', async () => {
    const { service } = makeService({ party: null });

    await expect(
      service.reject('third-party-user', 'proposal-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_PRICE_PROPOSAL_NOT_FOUND' });
  });

  it('throws QUOTE_PRICE_PROPOSAL_RESOLVE_CONFLICT when the CAS loses a race', async () => {
    const { service } = makeService({ casCount: 0 });

    await expect(service.reject('user-1', 'proposal-1')).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_RESOLVE_CONFLICT',
    });
  });
});
