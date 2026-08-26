import { Injectable } from '@nestjs/common';
import { QuoteNegotiationParty } from '@prisma/client';
import { ProfilesRepository } from '../profiles/profiles.repository';
import {
  ServiceRequestsRepository,
  ServiceRequestWithRelations,
} from '../service-requests/service-requests.repository';
import {
  QuotesRepository,
  QuoteWithRelations,
} from '../quotes/quotes.repository';
import { quoteNotFound } from '../quotes/errors/quote-not-found.error';

export interface QuoteNegotiationPartyResolution {
  role: QuoteNegotiationParty;
  quote: QuoteWithRelations;
  serviceRequest: ServiceRequestWithRelations;
  // Exactly one of these two is non-null, matching `role` — same
  // nullable-pair-of-profile-ids shape `QuoteNegotiationMessage`/
  // `QuotePriceProposal` themselves use.
  customerProfileId: string | null;
  professionalProfileId: string | null;
}

/**
 * Shared by all 4 Quote Negotiation operations
 * (`PostQuoteNegotiationMessageService`/`AcceptQuotePriceProposalService`/
 * `RejectQuotePriceProposalService`/`ListQuoteNegotiationMessagesService`)
 * — the ONE place that decides whether a caller is a party to a given
 * Quote, and which role they hold. Deliberately fetches `Quote`/
 * `ServiceRequest` itself (unlike the plan's originally-sketched
 * `resolveParty(userId, quote, serviceRequest)` signature) so every one of
 * the 4 call sites shares this exact lookup, rather than each re-fetching
 * `Quote`/`ServiceRequest` and passing them in — a documented, deliberate
 * simplification of the plan's literal wording.
 *
 * `ServiceRequestsRepository`/`QuotesRepository` are reused here as
 * CONCRETE provider classes (same "never import the resolver-bearing
 * Module" pattern `AcceptQuoteService`/`RejectQuoteService` already
 * establish) — `src/quote-negotiation/` never imports `QuotesModule`/
 * `ServiceRequestsModule`.
 */
@Injectable()
export class QuoteNegotiationAccessService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly quotesRepository: QuotesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
  ) {}

  /**
   * Throws the reused, anti-enumeration `quoteNotFound()` (same code as
   * `quotes/`'s own — imported directly, never duplicated) when the Quote
   * doesn't exist, or the caller is neither the owning Customer nor the
   * submitting Professional.
   */
  async resolveParty(
    userId: string,
    quoteId: string,
  ): Promise<QuoteNegotiationPartyResolution> {
    const resolved = await this.tryResolveParty(userId, quoteId);
    if (!resolved) {
      throw quoteNotFound();
    }
    return resolved;
  }

  /**
   * Same lookup as `resolveParty`, but returns `null` instead of throwing
   * when the Quote doesn't exist or the caller isn't a party — used by
   * `AcceptQuotePriceProposalService`/`RejectQuotePriceProposalService`,
   * which resolve a `QuotePriceProposal` FIRST (throwing the proposal's own
   * anti-enumeration `quotePriceProposalNotFound()` in that case, never
   * this method's `Quote`-flavored code — see those services' own
   * comments).
   */
  async tryResolveParty(
    userId: string,
    quoteId: string,
  ): Promise<QuoteNegotiationPartyResolution | null> {
    const quote = await this.quotesRepository.findById(quoteId);
    if (!quote) {
      return null;
    }

    const serviceRequest = await this.serviceRequestsRepository.findById(
      quote.serviceRequestId,
    );
    if (!serviceRequest) {
      return null;
    }

    const [customerProfile, professionalProfile] = await Promise.all([
      this.profilesRepository.findCustomerProfileByUserId(userId),
      this.profilesRepository.findProfessionalProfileByUserId(userId),
    ]);

    if (
      customerProfile &&
      serviceRequest.customerProfileId === customerProfile.id
    ) {
      return {
        role: QuoteNegotiationParty.CUSTOMER,
        quote,
        serviceRequest,
        customerProfileId: customerProfile.id,
        professionalProfileId: null,
      };
    }

    if (
      professionalProfile &&
      quote.professionalProfileId === professionalProfile.id
    ) {
      return {
        role: QuoteNegotiationParty.PROFESSIONAL,
        quote,
        serviceRequest,
        customerProfileId: null,
        professionalProfileId: professionalProfile.id,
      };
    }

    return null;
  }
}
