import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { MediaUploadsRepository } from '../media-uploads/media-uploads.repository';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { QuotesRepository } from '../quotes/quotes.repository';
import { ServiceRequestsRepository } from '../service-requests/service-requests.repository';
import { UsersModule } from '../users/users.module';
import { QuoteNegotiationModuleEnabledGuard } from './guards/quote-negotiation-module-enabled.guard';
import { QuoteNegotiationAccessService } from './quote-negotiation-access.service';
import { QuoteNegotiationRepository } from './quote-negotiation.repository';
import { QuoteNegotiationResolver } from './quote-negotiation.resolver';
import { AcceptQuotePriceProposalService } from './services/accept-quote-price-proposal.service';
import { ListQuoteNegotiationMessagesService } from './services/list-quote-negotiation-messages.service';
import { PostQuoteNegotiationMessageService } from './services/post-quote-negotiation-message.service';
import { RejectQuotePriceProposalService } from './services/reject-quote-price-proposal.service';

/**
 * GOS-53 — Quote Negotiation, a comment/price-negotiation thread on top of
 * the existing `Quote` entity (GOS-41), fully gated by admin-configurable
 * feature flags.
 *
 * **Feature-flag mechanism, confirmed with the human before implementation**:
 * the ticket's original premise ("hierarchical `FeatureFlagGroup`/
 * `FeatureFlagPort`") does not exist in this codebase — GOS-30/31/32
 * shipped a flat, dot-namespaced `PlatformSetting` model with a
 * `PlatformSettingPort.isEnabled(key)` read port, the actual, already-
 * implemented successor (see `PlatformSettingsModule`'s own header comment:
 * "the Slice-3 consolidation of what used to be ...
 * `FeatureFlagPort`"). All three flags this module reads
 * (`quote-negotiation.general.enabled`/`.price-edit.customer-can-propose`/
 * `.price-edit.professional-can-propose`) are real, seeded `PlatformSetting`
 * rows (see `prisma/seed.ts`), already read/write through the shipped
 * admin panel (`platformSettings`/`setPlatformSetting`) — satisfying
 * "administrable desde el panel admin" with zero new admin-UI work,
 * instead of hardcoding TS constants and deferring that capability.
 *
 * `PrismaModule` is `@Global()`, so `PrismaService` doesn't need to be
 * imported here explicitly. `QuotesRepository`/`ServiceRequestsRepository`
 * are reused here as CONCRETE provider classes (NOT imported via
 * `QuotesModule`/`ServiceRequestsModule`, which each have their own
 * `@Resolver()` — the same leak class this codebase avoids everywhere else)
 * — same "reuse the concrete repository class directly, never import the
 * resolver-bearing Module" pattern `quotes.module.ts`/
 * `service-requests.module.ts` already establish for each other.
 * `PlatformSettingsModule` is imported for `PlatformSettingPort` alone (the
 * SAME resolver-free module `AuthModule` already imports for the same
 * reason — see that module's own header comment on why it must stay
 * resolver-free).
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
    QuoteNegotiationResolver,
    QuoteNegotiationRepository,
    QuoteNegotiationAccessService,
    QuoteNegotiationModuleEnabledGuard,
    QuotesRepository,
    ServiceRequestsRepository,
    MediaUploadsRepository,
    PostQuoteNegotiationMessageService,
    AcceptQuotePriceProposalService,
    RejectQuotePriceProposalService,
    ListQuoteNegotiationMessagesService,
  ],
  exports: [QuoteNegotiationRepository],
})
export class QuoteNegotiationModule {}
