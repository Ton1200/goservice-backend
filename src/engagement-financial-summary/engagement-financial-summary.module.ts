import { Module } from '@nestjs/common';
import '../ledger/models/payment-method.enum'; // GraphQL enum registration side effect — first consumer-schema use of PaymentMethod.
import { AuthModule } from '../auth/auth.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { EngagementFinancialSummaryAccessService } from './engagement-financial-summary-access.service';
import { EngagementFinancialSummaryResolver } from './engagement-financial-summary.resolver';
import { GetEngagementFinancialSummaryService } from './services/get-engagement-financial-summary.service';

/**
 * GOS-130 follow-up — `engagementFinancialSummary(engagementId)`, a
 * consumer-facing, per-Engagement, role-restricted view over the SAME
 * `LedgerEntry` table `myPaymentReceipts`/`adminEngagementPaymentSummaries`
 * already read. A NEW, DEDICATED module (mirrors `src/reviews/`'s
 * skeleton) — deliberately NOT bolted onto `PaymentReceiptsModule`, which
 * is argument-free/unscoped by design and has no party-access-check of its
 * own.
 *
 * Imports: `AuthModule` for `SessionGuard`; `IdentityVerificationModule`
 * for `AccountApprovedGuard`; `UsersModule` directly too (same reasoning as
 * every other consumer module's own header comment: `AccountApprovedGuard`
 * needs `UsersRepository` resolvable from THIS module's own injector);
 * `ProfilesModule` for `ProfilesRepository`; `LedgerModule` (deliberately
 * resolver-free, safe to import directly) for `LedgerRepository`.
 *
 * `EngagementsRepository` is reused here as a CONCRETE provider class —
 * `src/engagement-financial-summary/` never imports `EngagementsModule`
 * itself, same "reuse the concrete repository class directly, never import
 * the resolver-bearing Module" pattern `ReviewsModule`/`EngagementChatModule`/
 * `QuoteNegotiationModule` already establish.
 *
 * This is a NEW module in the public `/graphql` schema's own `include`
 * array (`app.module.ts`) — `LedgerModule` itself stays out of that array,
 * same convention every other consumer module here follows.
 */
@Module({
  imports: [
    AuthModule,
    IdentityVerificationModule,
    LedgerModule,
    ProfilesModule,
    UsersModule,
  ],
  providers: [
    EngagementsRepository,
    EngagementFinancialSummaryAccessService,
    GetEngagementFinancialSummaryService,
    EngagementFinancialSummaryResolver,
  ],
})
export class EngagementFinancialSummaryModule {}
