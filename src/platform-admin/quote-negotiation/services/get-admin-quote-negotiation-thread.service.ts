import { Injectable } from '@nestjs/common';
import { QuotesRepository } from '../../../quotes/quotes.repository';
import { QuoteNegotiationRepository } from '../../../quote-negotiation/quote-negotiation.repository';
import { QuoteNegotiationMessageModel } from '../../../quote-negotiation/models/quote-negotiation-message.model';
import { adminQuoteNotFound } from '../../quotes/errors/admin-quote.errors';

/**
 * Orchestrates `Query.adminQuoteNegotiationThread` — the admin panel's
 * read-only audit view of a Quote's full negotiation history: every
 * message, and every linked price proposal, UNREDACTED (price is not
 * sensitive per the AC — unlike GOS-30's credential masking, there is no
 * `maskedPreview`-shaped concern here).
 *
 * Reuses `QuoteNegotiationMessageModel`/`QuotePriceProposalModel`
 * (`src/quote-negotiation/models/`) DIRECTLY as this query's return type,
 * rather than a separate `AdminQuoteNegotiationMessage`-named duplicate —
 * unlike `AdminQuoteRow`/`AdminQuoteServiceRequest` (which genuinely needed
 * EXTRA relational data — `serviceRequest`/`professionalProfile.user` — not
 * on the consumer `QuoteModel`), the consumer negotiation-thread shape
 * already carries everything this admin view needs, unredacted, so
 * duplicating a byte-identical type would be pure ceremony. Same "orphaned
 * type made reachable" pattern `userAccountDetail` already established for
 * `CustomerProfile`/`ProfessionalProfile` — a deliberate simplification of
 * the plan's literal `AdminQuoteNegotiationMessage` type name, flagged in
 * the delivery report.
 */
@Injectable()
export class GetAdminQuoteNegotiationThreadService {
  constructor(
    private readonly quotesRepository: QuotesRepository,
    private readonly quoteNegotiationRepository: QuoteNegotiationRepository,
  ) {}

  async getThread(quoteId: string): Promise<QuoteNegotiationMessageModel[]> {
    const quote = await this.quotesRepository.findById(quoteId);
    if (!quote) {
      throw adminQuoteNotFound(quoteId);
    }
    return this.quoteNegotiationRepository.findMessagesByQuoteId(quoteId);
  }
}
