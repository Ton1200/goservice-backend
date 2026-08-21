import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { DiditIdentityVerificationAdapter } from './adapters/didit-identity-verification.adapter';
import { DiditWebhookController } from './controllers/didit-webhook.controller';
import { AccountApprovedGuard } from './guards/account-approved.guard';
import { IdentityVerificationRepository } from './identity-verification.repository';
import { IdentityVerificationResolver } from './identity-verification.resolver';
import { IdentityVerificationPort } from './ports/identity-verification.port';
import { GetMyIdentityVerificationStatusService } from './services/get-my-identity-verification-status.service';
import { HandleIdentityVerificationWebhookService } from './services/handle-identity-verification-webhook.service';
import { IdentityVerificationProviderRegistry } from './services/identity-verification-provider-registry.service';
import { StartIdentityVerificationService } from './services/start-identity-verification.service';

/**
 * `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
 * need to be imported here explicitly.
 *
 * Imports: `AuthModule` for `SessionGuard`
 * (`startIdentityVerification`/`myIdentityVerificationStatus` both require
 * an active session); `UsersModule` for `UsersRepository` (account-status
 * reads + `transitionFromPendingApproval`); `ProfilesModule` for
 * `ProfilesRepository.findCountryForUser` (the ONLY source of `country` —
 * see `StartIdentityVerificationService`); `PlatformSettingsModule` for
 * `PlatformSettingPort` (kill switches + Didit credentials, same seam every
 * other provider-gated feature in this backend already uses).
 *
 * `DiditIdentityVerificationAdapter` is registered as itself (a concrete
 * provider) AND aliased to the `IdentityVerificationPort` token via
 * `useExisting` — so `IdentityVerificationProviderRegistry` (which depends
 * on the concrete class directly, per its own header comment) and any
 * FUTURE consumer that depends on the abstract `IdentityVerificationPort`
 * instead share the exact same singleton instance, never two separate
 * ones.
 *
 * `DiditWebhookController` is this module's (and this codebase's) FIRST
 * REST controller — registered via `controllers`, not `providers`; it is
 * NOT part of either GraphQL schema's `include` array (see `app.module.ts`)
 * since it's a plain Express route, reachable at
 * `/webhooks/didit/identity-verification` regardless of GraphQL schema
 * wiring.
 *
 * `AccountApprovedGuard` is exported (not just provided) for the same
 * forward-looking reason `SessionGuard` is exported by `AuthModule` — see
 * that guard's own header comment for why it has no consumer yet.
 */
@Module({
  imports: [AuthModule, UsersModule, ProfilesModule, PlatformSettingsModule],
  controllers: [DiditWebhookController],
  providers: [
    IdentityVerificationResolver,
    IdentityVerificationRepository,
    DiditIdentityVerificationAdapter,
    {
      provide: IdentityVerificationPort,
      useExisting: DiditIdentityVerificationAdapter,
    },
    IdentityVerificationProviderRegistry,
    StartIdentityVerificationService,
    GetMyIdentityVerificationStatusService,
    HandleIdentityVerificationWebhookService,
    AccountApprovedGuard,
  ],
  exports: [AccountApprovedGuard],
})
export class IdentityVerificationModule {}
