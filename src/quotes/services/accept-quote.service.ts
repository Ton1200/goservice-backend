import { Injectable, Logger } from '@nestjs/common';
import { QuoteStatus, ServiceRequestStatus } from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { QuoteNegotiationRepository } from '../../quote-negotiation/quote-negotiation.repository';
import { customerProfileRequired } from '../../service-requests/errors/customer-profile-required.error';
import { ServiceRequestModel } from '../../service-requests/models/service-request.model';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { quoteAcceptConflict } from '../errors/quote-accept-conflict.error';
import { quoteHasPendingPriceProposal } from '../errors/quote-has-pending-price-proposal.error';
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
 * (`quoteNotFound`/`quoteNotSent`/`serviceRequestNotOpen`/
 * `quoteHasPendingPriceProposal`). The actual safety mechanism against a
 * concurrent accept/cancel/withdraw is the two guarded `updateMany` CAS
 * writes INSIDE the transaction — either can report `count !== 1` even
 * when the pre-read looked fine a moment earlier, in which case this
 * throws the generic, non-enumerating `quoteAcceptConflict()` and the
 * whole transaction rolls back: no `Engagement` is ever created, and
 * neither the `ServiceRequest` nor the `Quote` end up partially
 * transitioned.
 *
 * GOS-53 follow-up: also refuses to accept a Quote while it has an
 * unresolved `PENDING` `QuotePriceProposal` open against it — see
 * `quoteHasPendingPriceProposal()`'s own comment for the business-rule
 * gap this closes (`Engagement` stores no price of its own; the "real"
 * price is always `Quote.negotiatedPrice ?? Quote.price`, so accepting
 * while a negotiation is unresolved would silently lock in the wrong
 * price). This check is pre-transaction only, same "good error message,
 * not the actual race guard" posture as the other pre-read checks above —
 * unlike `ServiceRequest.status`/`Quote.status`, there is no CAS write
 * touching `QuotePriceProposal` in this transaction, so a proposal created
 * in the narrow window between this check and the transaction committing
 * is a known, accepted (not CAS-guarded) race, same class of risk this
 * codebase already accepts for other pre-only reads.
 * `QuoteNegotiationRepository` is reused here as a CONCRETE provider class
 * (NOT imported via `QuoteNegotiationModule`, which has its own
 * `@Resolver()` and — critically — already reuses `QuotesRepository` in
 * the OPPOSITE direction; importing `QuoteNegotiationModule` here would
 * create a two-way module cycle) — same "reuse the concrete repository
 * class directly, never import the resolver-bearing Module" pattern this
 * file's own header already documents for `ServiceRequestsRepository`.
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
    private readonly quoteNegotiationRepository: QuoteNegotiationRepository,
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

    const pendingProposal =
      await this.quoteNegotiationRepository.findPendingProposalByQuoteId(
        quote.id,
      );
    if (pendingProposal) {
      throw quoteHasPendingPriceProposal();
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
