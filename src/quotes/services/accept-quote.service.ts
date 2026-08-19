import { Injectable, Logger } from '@nestjs/common';
import { QuoteStatus, ServiceRequestStatus } from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { customerProfileRequired } from '../../service-requests/errors/customer-profile-required.error';
import { ServiceRequestModel } from '../../service-requests/models/service-request.model';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { quoteAcceptConflict } from '../errors/quote-accept-conflict.error';
import { quoteNotFound } from '../errors/quote-not-found.error';
import { quoteNotSent } from '../errors/quote-not-sent.error';
import { serviceRequestNotOpen } from '../errors/service-request-not-open.error';
import { QuotesRepository } from '../quotes.repository';

/**
 * Orchestrates `Mutation.acceptQuote` — the transactional core of GOS-41
 * (see the GOS-41 plan's decision #5). Owns the transaction boundary
 * itself (injects `PrismaService` directly, same pattern
 * `CreateServiceRequestForCustomerService` already establishes) because it
 * spans three tables owned by three different repositories
 * (`ServiceRequestsRepository`, `QuotesRepository`, `EngagementsRepository`)
 * that must commit atomically or not at all.
 *
 * `ServiceRequestsRepository`/`EngagementsRepository` are reused here as
 * CONCRETE provider classes, injected directly into `QuotesModule` — this
 * module deliberately never imports `ServiceRequestsModule` (see
 * `quotes.module.ts`'s own comment for why: same "reuse the concrete
 * repository class directly, never import the resolver-bearing Module"
 * pattern already established elsewhere in this codebase, e.g.
 * `PlatformAdminModule`'s reuse of `UsersRepository`/
 * `ServiceRequestsRepository`).
 *
 * A pre-read happens BEFORE the transaction, purely for a good, SPECIFIC
 * error message in the common (non-race) case
 * (`quoteNotFound`/`quoteNotSent`/`serviceRequestNotOpen`). The actual
 * safety mechanism against a concurrent accept/cancel/withdraw is the two
 * guarded `updateMany` CAS writes INSIDE the transaction — either can
 * report `count !== 1` even when the pre-read looked fine a moment
 * earlier, in which case this throws the generic, non-enumerating
 * `quoteAcceptConflict()` and the whole transaction rolls back: no
 * `Engagement` is ever created, and neither the `ServiceRequest` nor the
 * `Quote` end up partially transitioned.
 *
 * Transaction order (see the GOS-41 plan's decision #5):
 *   (a) CAS `ServiceRequest.status: OPEN -> ENGAGED` + set `acceptedQuoteId`
 *   (b) CAS `Quote.status: SENT -> ACCEPTED` (scoped to this
 *       `serviceRequestId` too, defense in depth)
 *   (c) bulk-transition every OTHER `SENT` Quote on the same
 *       `ServiceRequest` to `REJECTED` (0 rows affected is a valid outcome)
 *   (d) create the `Engagement` row
 *
 * Returns the updated `ServiceRequest` (not the `Engagement` directly) —
 * the caller already has the `ServiceRequest` it acted on;
 * `engagement`/`acceptedQuote` are reachable from it in one round-trip via
 * `ServiceRequestFieldResolver`.
 */
@Injectable()
export class AcceptQuoteService {
  private readonly logger = new Logger(AcceptQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
    private readonly quotesRepository: QuotesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  async acceptQuote(
    userId: string,
    quoteId: string,
  ): Promise<ServiceRequestModel> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw customerProfileRequired();
    }

    const quote = await this.quotesRepository.findById(quoteId);
    if (!quote) {
      throw quoteNotFound();
    }

    const serviceRequest = await this.serviceRequestsRepository.findById(
      quote.serviceRequestId,
    );
    if (
      !serviceRequest ||
      serviceRequest.customerProfileId !== customerProfile.id
    ) {
      // Same code for "doesn't exist" and "exists but isn't yours" —
      // deliberate anti-enumeration choice, see quoteNotFound()'s own
      // comment. Deliberately checked via the OWNING ServiceRequest, not
      // just the Quote's own existence, since a Quote can never be
      // accepted by anyone other than the ServiceRequest's own Customer.
      throw quoteNotFound();
    }

    if (serviceRequest.status !== ServiceRequestStatus.OPEN) {
      throw serviceRequestNotOpen();
    }
    if (quote.status !== QuoteStatus.SENT) {
      throw quoteNotSent();
    }

    await this.prisma.$transaction(async (tx) => {
      const serviceRequestCas =
        await this.serviceRequestsRepository.transitionToEngagedIfOpen(
          tx,
          serviceRequest.id,
          quote.id,
        );
      if (serviceRequestCas.count !== 1) {
        throw quoteAcceptConflict();
      }

      const quoteCas = await this.quotesRepository.transitionToAcceptedIfSent(
        tx,
        quote.id,
        serviceRequest.id,
      );
      if (quoteCas.count !== 1) {
        throw quoteAcceptConflict();
      }

      await this.quotesRepository.rejectSiblingsSent(
        tx,
        serviceRequest.id,
        quote.id,
      );

      await this.engagementsRepository.create(tx, {
        serviceRequestId: serviceRequest.id,
        quoteId: quote.id,
        customerProfileId: customerProfile.id,
        professionalProfileId: quote.professionalProfileId,
      });
    });

    const updated = await this.serviceRequestsRepository.findById(
      serviceRequest.id,
    );

    this.logger.log({
      event: 'quote_accepted',
      outcome: 'success',
      quoteId: quote.id,
      serviceRequestId: serviceRequest.id,
    });

    return updated!;
  }
}
