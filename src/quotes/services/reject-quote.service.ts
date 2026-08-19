import { Injectable, Logger } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { customerProfileRequired } from '../../service-requests/errors/customer-profile-required.error';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { quoteNotFound } from '../errors/quote-not-found.error';
import { quoteNotSent } from '../errors/quote-not-sent.error';
import { QuoteModel } from '../models/quote.model';
import { QuotesRepository } from '../quotes.repository';

/**
 * Orchestrates `Mutation.rejectQuote` — an explicit Customer rejection of
 * one of the Quotes submitted against their own `ServiceRequest`.
 * Ownership is checked via `quote.serviceRequest.customerProfileId` (this
 * service reads the owning `ServiceRequest` itself, via
 * `ServiceRequestsRepository`, reused directly — the SAME concrete-class
 * reuse pattern `AcceptQuoteService` establishes for the same reason:
 * `quotes/` never imports `ServiceRequestsModule`, see that service's own
 * comment).
 */
@Injectable()
export class RejectQuoteService {
  private readonly logger = new Logger(RejectQuoteService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
    private readonly quotesRepository: QuotesRepository,
  ) {}

  async rejectQuote(userId: string, quoteId: string): Promise<QuoteModel> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw customerProfileRequired();
    }

    const existing = await this.quotesRepository.findById(quoteId);
    if (!existing) {
      throw quoteNotFound();
    }

    const serviceRequest = await this.serviceRequestsRepository.findById(
      existing.serviceRequestId,
    );
    if (
      !serviceRequest ||
      serviceRequest.customerProfileId !== customerProfile.id
    ) {
      // Same code for "doesn't exist" and "exists but isn't yours" —
      // deliberate anti-enumeration choice, see quoteNotFound()'s own
      // comment.
      throw quoteNotFound();
    }

    const { count } = await this.quotesRepository.reject(quoteId);
    if (count !== 1) {
      throw quoteNotSent();
    }

    const rejected = await this.quotesRepository.findById(quoteId);

    this.logger.log({
      event: 'quote_rejected',
      outcome: 'success',
      quoteId,
    });

    return rejected!;
  }
}
