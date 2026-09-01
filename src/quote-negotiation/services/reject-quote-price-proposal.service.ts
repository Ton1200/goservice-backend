import { Injectable, Logger } from '@nestjs/common';
import { QuotePriceProposalStatus, QuoteStatus } from '@prisma/client';
import { QuoteNegotiationAccessService } from '../quote-negotiation-access.service';
import { QuoteNegotiationRepository } from '../quote-negotiation.repository';
import { quoteNotNegotiable } from '../errors/quote-not-negotiable.error';
import { quotePriceProposalNotFound } from '../errors/quote-price-proposal-not-found.error';
import { quotePriceProposalNotPending } from '../errors/quote-price-proposal-not-pending.error';
import { quotePriceProposalResolveConflict } from '../errors/quote-price-proposal-resolve-conflict.error';
import { quotePriceProposalSelfResolveForbidden } from '../errors/quote-price-proposal-self-resolve-forbidden.error';
import { QuotePriceProposalModel } from '../models/quote-price-proposal.model';

/**
 * Orchestrates `Mutation.rejectQuotePriceProposal` — same ordering of
 * checks as `AcceptQuotePriceProposalService` (see that service's own
 * comment). Unlike accept, rejecting a proposal touches nothing on `Quote`
 * — a single guarded `updateMany` CAS write, no `$transaction` wrapper
 * needed (same "single-write, no transaction" posture as
 * `RejectQuoteService`).
 */
@Injectable()
export class RejectQuotePriceProposalService {
  private readonly logger = new Logger(RejectQuotePriceProposalService.name);

  constructor(
    private readonly accessService: QuoteNegotiationAccessService,
    private readonly quoteNegotiationRepository: QuoteNegotiationRepository,
  ) {}

  async reject(
    userId: string,
    proposalId: string,
  ): Promise<QuotePriceProposalModel> {
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

    const cas = await this.quoteNegotiationRepository.rejectProposal(
      proposalId,
      {
        resolvedByCustomerProfileId: party.customerProfileId,
        resolvedByProfessionalProfileId: party.professionalProfileId,
      },
    );
    if (cas.count !== 1) {
      throw quotePriceProposalResolveConflict();
    }

    const rejected =
      await this.quoteNegotiationRepository.findProposalById(proposalId);

    this.logger.log({
      event: 'quote_price_proposal_rejected',
      outcome: 'success',
      quoteId: proposal.quoteId,
      proposalId: proposal.id,
    });

    return rejected!;
  }
}
