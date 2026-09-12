import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { ReviewsModuleEnabledGuard } from './guards/reviews-module-enabled.guard';
import { ReviewsAccessService } from './reviews-access.service';
import { ReviewsQueriesResolver } from './reviews-queries.resolver';
import { ReviewsRepository } from './reviews.repository';
import { ReviewsResolver } from './reviews.resolver';
import { ListMyReceivedReviewsService } from './services/list-my-received-reviews.service';
import { SubmitEngagementReviewService } from './services/submit-engagement-review.service';

/**
 * GOS-121 — mutual Engagement ratings/reviews, with admin comment
 * moderation. `PrismaModule` is `@Global()`, so `PrismaService` doesn't need
 * to be imported here explicitly.
 *
 * Imports: `AuthModule` for `SessionGuard`; `IdentityVerificationModule` for
 * `AccountApprovedGuard`; `UsersModule` directly too (same reasoning as
 * `EngagementsModule`'s/`EngagementChatModule`'s own header comments:
 * `AccountApprovedGuard` needs `UsersRepository` resolvable from THIS
 * module's own injector, not only `IdentityVerificationModule`'s own);
 * `PlatformSettingsModule` for `PlatformSettingPort`
 * (`ReviewsModuleEnabledGuard`'s `reviews.rating.enabled` read, AND
 * `SubmitEngagementReviewService`'s own second `reviews.comment.enabled`
 * read) — the SAME resolver-free module `QuoteNegotiationModule`/
 * `EngagementChatModule`/`AuthModule` already import for the same reason;
 * `ProfilesModule` for `ProfilesRepository`.
 *
 * `EngagementsRepository` is reused here as a CONCRETE provider class —
 * `src/reviews/` never imports `EngagementsModule` itself, same "reuse the
 * concrete repository class directly, never import the resolver-bearing
 * Module" pattern `EngagementChatModule`/`QuoteNegotiationModule` already
 * establish.
 *
 * `ReviewsRepository` is exported so `ProfilesModule`
 * (`ProfessionalProfileFieldResolver` — `averageRating`/`reviewCount`) and
 * `PlatformAdminModule` (`src/platform-admin/reviews/`) can each reuse it
 * directly as a concrete provider, WITHOUT importing `ReviewsModule` itself
 * (which owns its own resolvers) — same pattern `EngagementsModule`
 * exporting `EngagementsRepository` already establishes.
 */
@Module({
  imports: [
    AuthModule,
    IdentityVerificationModule,
    PlatformSettingsModule,
    ProfilesModule,
    UsersModule,
  ],
  providers: [
    ReviewsResolver,
    ReviewsQueriesResolver,
    ReviewsRepository,
    ReviewsAccessService,
    ReviewsModuleEnabledGuard,
    EngagementsRepository,
    SubmitEngagementReviewService,
    ListMyReceivedReviewsService,
  ],
  exports: [ReviewsRepository],
})
export class ReviewsModule {}
