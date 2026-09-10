import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { MediaUploadsRepository } from '../media-uploads/media-uploads.repository';
import { ProfilesModule } from '../profiles/profiles.module';
import { QuoteNegotiationRepository } from '../quote-negotiation/quote-negotiation.repository';
import { ServiceRequestsRepository } from '../service-requests/service-requests.repository';
import { UsersModule } from '../users/users.module';
import { QuoteFieldResolver } from './quote-field.resolver';
import { QuotesRepository } from './quotes.repository';
import { QuotesResolver } from './quotes.resolver';
import { AcceptQuoteService } from './services/accept-quote.service';
import { AddQuoteAttachmentsService } from './services/add-quote-attachments.service';
import { ListMyQuotesService } from './services/list-my-quotes.service';
import { ListQuotesForServiceRequestService } from './services/list-quotes-for-service-request.service';
import { RejectQuoteService } from './services/reject-quote.service';
import { SubmitQuoteService } from './services/submit-quote.service';
import { WithdrawQuoteService } from './services/withdraw-quote.service';

/**
 * `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
 * need to be imported here explicitly.
 *
 * Imports: `AuthModule`/`IdentityVerificationModule`/`UsersModule` for the
 * same guard-resolution reasons `ServiceRequestsModule`'s own header
 * comment documents; `ProfilesModule` for `ProfilesRepository`;
 * `EngagementsModule` for `EngagementsRepository` (`AcceptQuoteService`
 * needs it to create the `Engagement` row inside its transaction) — a
 * normal, non-cyclical import (`EngagementsModule` depends on neither
 * `quotes/` nor `service-requests/`).
 *
 * `ServiceRequestsRepository` is reused here as a CONCRETE provider class
 * (NOT imported via `ServiceRequestsModule`, which has its own
 * `ServiceRequestsResolver`) — `AcceptQuoteService`/`RejectQuoteService`
 * both need to read/mutate `ServiceRequest` rows, but `quotes/` must NEVER
 * import `ServiceRequestsModule` back (it, in turn, needs to reuse
 * `QuotesRepository`/`EngagementsRepository` — see
 * `service-request-field.resolver.ts` — which would form a cycle). Same
 * "reuse the concrete repository class directly, never import the
 * resolver-bearing Module" pattern already established elsewhere in this
 * codebase (see `service-requests.module.ts`'s/`platform-admin.module.ts`'s
 * own comments).
 *
 * `QuoteNegotiationRepository` is reused the SAME way (GOS-53 follow-up) —
 * `AcceptQuoteService` needs to check for an unresolved `PENDING`
 * `QuotePriceProposal` before accepting a `Quote` (see that service's own
 * comment), but `quotes/` must NEVER import `QuoteNegotiationModule` back
 * (it, in turn, already reuses `QuotesRepository`/`ServiceRequestsRepository`
 * this same concrete-provider way — see `quote-negotiation.module.ts`'s own
 * comment — so importing it here would form a two-way module cycle).
 *
 * `MediaUploadsRepository` (GOS-72) is reused the SAME concrete-provider way
 * — `AddQuoteAttachmentsService` validates + consumes the submitted
 * `MediaUploadRef`s in the same transaction as the `QuoteAttachment` rows;
 * `quotes/` never imports `MediaUploadsModule` (which carries
 * `MediaUploadsResolver`).
 */
@Module({
  imports: [
    AuthModule,
    EngagementsModule,
    IdentityVerificationModule,
    ProfilesModule,
    UsersModule,
  ],
  providers: [
    QuotesResolver,
    QuoteFieldResolver,
    QuotesRepository,
    ServiceRequestsRepository,
    QuoteNegotiationRepository,
    MediaUploadsRepository,
    SubmitQuoteService,
    WithdrawQuoteService,
    ListQuotesForServiceRequestService,
    ListMyQuotesService,
    AcceptQuoteService,
    RejectQuoteService,
    AddQuoteAttachmentsService,
  ],
  exports: [QuotesRepository],
})
export class QuotesModule {}
