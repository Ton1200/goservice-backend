import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngagementsModule } from '../engagements/engagements.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ServiceRequestsRepository } from '../service-requests/service-requests.repository';
import { UsersModule } from '../users/users.module';
import { QuotesRepository } from './quotes.repository';
import { QuotesResolver } from './quotes.resolver';
import { AcceptQuoteService } from './services/accept-quote.service';
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
    QuotesRepository,
    ServiceRequestsRepository,
    SubmitQuoteService,
    WithdrawQuoteService,
    ListQuotesForServiceRequestService,
    ListMyQuotesService,
    AcceptQuoteService,
    RejectQuoteService,
  ],
  exports: [QuotesRepository],
})
export class QuotesModule {}
