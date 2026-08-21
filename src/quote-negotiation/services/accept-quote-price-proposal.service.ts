import { Injectable, Logger } from '@nestjs/common';
import { QuotePriceProposalStatus, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotesRepository } from '../../quotes/quotes.repository';
import { QuoteModel } from '../../quotes/models/quote.model';
import { QuoteNegotiationAccessService } from '../quote-negotiation-access.service';
import { QuoteNegotiationRepository } from '../quote-negotiation.repository';
import { quoteNotNegotiable } from '../errors/quote-not-negotiable.error';
import { quotePriceProposalNotFound } from '../errors/quote-price-proposal-not-found.error';
import { quotePriceProposalNotPending } from '../errors/quote-price-proposal-not-pending.error';
import { quotePriceProposalResolveConflict } from '../errors/quote-price-proposal-resolve-conflict.error';
import { quotePriceProposalSelfResolveForbidden } from '../errors/quote-price-proposal-self-resolve-forbidden.error';

/**
 * Orchestrates `Mutation.acceptQuotePriceProposal`. Resolves the caller's
 * party via `proposal.quoteId` (never trusts a client-supplied role) —
 * `QuotesRepository`/`ServiceRequestsRepository` (transitively, via
 * `QuoteNegotiationAccessService`) are reused as CONCRETE providers, same
 * "never import the resolver-bearing Module" pattern `AcceptQuoteService`
 * already establishes.
 *
 * Ordering of checks (all before the transaction, for a good specific
 * error in the common case): (1) proposal exists
 * (`quotePriceProposalNotFound()`, anti-enumeration — same code whether the
 * id doesn't exist or the caller isn't a party to its Quote); (2) caller is
 * NOT the proposal's own author (`quotePriceProposalSelfResolveForbidden()`
 * — checked BEFORE the state checks below, so a self-attempt gets this
 * specific error regardless of the proposal's/Quote's current state); (3)
 * Quote is still `SENT` (`quoteNotNegotiable()`); (4) proposal is still
 * `PENDING` (`quotePriceProposalNotPending()`).
 *
 * Inside one transaction: CAS `QuotePriceProposal.status: PENDING ->
 * ACCEPTED` (a lost race throws the generic, non-enumerating
 * `quotePriceProposalResolveConflict()` and rolls back — same idiom as
 * `AcceptQuoteService`'s own `quoteAcceptConflict()`), then
 * `QuotesRepository.setNegotiatedPrice` writes `Quote.negotiatedPrice` —
 * `Quote.price` (the original quoted price) is never touched.
 */
@Injectable()
export class AcceptQuotePriceProposalService {
  private readonly logger = new Logger(AcceptQuotePriceProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: QuoteNegotiationAccessService,
    private readonly quoteNegotiationRepository: QuoteNegotiationRepository,
    private readonly quotesRepository: QuotesRepository,
  ) {}

  async accept(userId: string, proposalId: string): Promise<QuoteModel> {
    const proposal =
      await this.quoteNegotiationRepository.findProposalById(proposalId);
    if (!proposal) {
      throw quotePriceProposalNotFound();
    }

    const party = await this.accessService.tryResolveParty(
      userId,
      proposal.quoteId,
    );
    if (!party) {
      // Same anti-enumeration code as the "proposal doesn't exist" case
      // above — a caller who isn't a party to this proposal's Quote must
      // never be able to distinguish "no such proposal" from "not yours".
      throw quotePriceProposalNotFound();
    }

    if (party.role === proposal.proposedByRole) {
      throw quotePriceProposalSelfResolveForbidden();
    }
    if (party.quote.status !== QuoteStatus.SENT) {
      throw quoteNotNegotiable();
    }
    if (proposal.status !== QuotePriceProposalStatus.PENDING) {
      throw quotePriceProposalNotPending();
    }

    await this.prisma.$transaction(async (tx) => {
      const cas = await this.quoteNegotiationRepository.acceptProposal(
        tx,
        proposalId,
        {
          resolvedByCustomerProfileId: party.customerProfileId,
          resolvedByProfessionalProfileId: party.professionalProfileId,
        },
      );
      if (cas.count !== 1) {
        throw quotePriceProposalResolveConflict();
      }

      await this.quotesRepository.setNegotiatedPrice(
        tx,
        proposal.quoteId,
        proposal.proposedPrice,
      );
    });

    const updatedQuote = await this.quotesRepository.findById(proposal.quoteId);

    this.logger.log({
      event: 'quote_price_proposal_accepted',
      outcome: 'success',
      quoteId: proposal.quoteId,
      proposalId: proposal.id,
    });

    return updatedQuote!;
  }
}
