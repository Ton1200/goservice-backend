import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { MediaUploadsRepository } from '../media-uploads/media-uploads.repository';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { EngagementChatAccessService } from './engagement-chat-access.service';
import { EngagementChatModuleEnabledGuard } from './guards/engagement-chat-module-enabled.guard';
import { EngagementChatRepository } from './engagement-chat.repository';
import { EngagementChatResolver } from './engagement-chat.resolver';
import { EngagementMessageFieldResolver } from './engagement-message-field.resolver';
import { EmitEngagementLifecycleSystemMessageService } from './services/emit-engagement-lifecycle-system-message.service';
import { ListEngagementMessagesService } from './services/list-engagement-messages.service';
import { SendEngagementMessageService } from './services/send-engagement-message.service';

/**
 * GOS-46 — Chat de Coordinación, a free-text coordination thread on top of
 * the existing `Engagement` entity (GOS-41/GOS-55), purely additive — never
 * a path to mutate `Quote`/`Engagement` state.
 *
 * `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
 * need to be imported here explicitly. Imports: `AuthModule` for
 * `SessionGuard`; `IdentityVerificationModule` for `AccountApprovedGuard`;
 * `UsersModule` directly too (same reasoning as `ServiceRequestsModule`'s/
 * `EngagementsModule`'s own header comments: `AccountApprovedGuard` needs
 * `UsersRepository` resolvable from THIS module's injector, not only
 * `IdentityVerificationModule`'s own); `ProfilesModule` for
 * `ProfilesRepository`.
 *
 * `EngagementsRepository` is reused here as a CONCRETE provider class (same
 * "reuse the concrete repository class directly, never import the
 * resolver-bearing Module" pattern `QuoteNegotiationModule` already
 * establishes for `QuotesRepository`/`ServiceRequestsRepository`) —
 * `src/engagement-chat/` never imports `EngagementsModule` itself, avoiding
 * a two-way module dependency (this is exactly the reuse
 * `EngagementsModule`'s own header comment anticipated: "This also gives a
 * future Chat/Notifications module a clean import point without dragging in
 * all of `quotes/`").
 *
 * **Admin enable/disable toggle (follow-up round)**: `PlatformSettingsModule`
 * is now also imported, for `PlatformSettingPort` alone — the SAME
 * resolver-free module `QuoteNegotiationModule`/`AuthModule` already import
 * for the same reason (see those modules' own header comments) — so
 * `EngagementChatModuleEnabledGuard` can read the
 * `customer.chat.enabled` `PlatformSetting`.
 *
 * **GOS-125**: `EngagementMessageFieldResolver` adds
 * `EngagementMessage.engagementStatus`; `EmitEngagementLifecycleSystemMessageService`
 * is the SYSTEM-message emitter called from inside `src/engagements/`'s 5
 * lifecycle-transition transactions — it's provided here (not imported by
 * `EngagementsModule`) but ALSO listed directly as a concrete provider in
 * `EngagementsModule.providers` itself, same "reuse the concrete
 * class directly, never import the resolver-bearing Module" pattern this
 * module already uses for `EngagementsRepository` above, mirrored back the
 * other way.
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
    EngagementChatResolver,
    EngagementChatRepository,
    EngagementChatAccessService,
    EngagementChatModuleEnabledGuard,
    EngagementsRepository,
    MediaUploadsRepository,
    SendEngagementMessageService,
    ListEngagementMessagesService,
    // GOS-125
    EngagementMessageFieldResolver,
    EmitEngagementLifecycleSystemMessageService,
  ],
  exports: [EngagementChatRepository],
})
export class EngagementChatModule {}
