import { Injectable, Logger } from '@nestjs/common';
import { ServiceRequestStatus } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { serviceRequestNotFound } from '../../service-requests/errors/service-request-not-found.error';
import { invalidQuotePrice } from '../errors/invalid-quote-price.error';
import { professionalProfileRequired } from '../errors/professional-profile-required.error';
import { serviceRequestNotOpen } from '../errors/service-request-not-open.error';
import { QuoteModel } from '../models/quote.model';
import { SubmitQuoteInput } from '../models/submit-quote-input.model';
import { QuotesRepository } from '../quotes.repository';

/**
 * Orchestrates `Mutation.submitQuote`. The owning `ProfessionalProfile` is
 * ALWAYS resolved server-side from `@CurrentUser()` — this service never
 * receives or trusts a `professionalProfileId` from the caller (see
 * `SubmitQuoteInput`, which has no such field).
 *
 * `serviceRequestNotFound()` is REUSED directly from `service-requests/`
 * (not duplicated under a new name) — same "not found" semantics apply
 * regardless of which module happens to reference the id.
 * `serviceRequestNotOpen()`, unlike that reused error, is NOT
 * anti-enumeration — see that error's own comment for why (a Professional
 * legitimately discovers this id via `compatibleServiceRequests`).
 */
@Injectable()
export class SubmitQuoteService {
  private readonly logger = new Logger(SubmitQuoteService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
    private readonly quotesRepository: QuotesRepository,
  ) {}

  async submitQuote(
    userId: string,
    input: SubmitQuoteInput,
  ): Promise<QuoteModel> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (!professionalProfile) {
      throw professionalProfileRequired();
    }

    const serviceRequest = await this.serviceRequestsRepository.findById(
      input.serviceRequestId,
    );
    if (!serviceRequest) {
      throw serviceRequestNotFound();
    }
    if (serviceRequest.status !== ServiceRequestStatus.OPEN) {
      throw serviceRequestNotOpen();
    }

    if (input.price <= 0) {
      throw invalidQuotePrice();
    }

    const quote = await this.quotesRepository.create({
      serviceRequestId: input.serviceRequestId,
      professionalProfileId: professionalProfile.id,
      price: input.price,
      message: input.message,
    });

    this.logger.log({
      event: 'quote_submitted',
      outcome: 'success',
      quoteId: quote.id,
      serviceRequestId: quote.serviceRequestId,
    });

    return quote;
  }
}
