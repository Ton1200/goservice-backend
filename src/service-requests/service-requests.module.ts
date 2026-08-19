import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { QuotesRepository } from '../quotes/quotes.repository';
import { UsersModule } from '../users/users.module';
import { LocalDevStorageAdapter } from './adapters/local-dev-storage.adapter';
import { UploadsController } from './controllers/uploads.controller';
import { StoragePort } from './ports/storage.port';
import { ServiceRequestFieldResolver } from './service-request-field.resolver';
import { CancelServiceRequestService } from './services/cancel-service-request.service';
import { ListCompatibleServiceRequestsService } from './services/list-compatible-service-requests.service';
import { ListMyServiceRequestsService } from './services/list-my-service-requests.service';
import { PublishServiceRequestService } from './services/publish-service-request.service';
import { RequestServiceRequestAttachmentUploadUrlService } from './services/request-service-request-attachment-upload-url.service';
import { ServiceRequestsRepository } from './service-requests.repository';
import { ServiceRequestsResolver } from './service-requests.resolver';

/**
 * `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
 * need to be imported here explicitly.
 *
 * Imports: `AuthModule` for `SessionGuard` (every operation requires an
 * active session); `IdentityVerificationModule` for `AccountApprovedGuard`
 * — that module's own header comment already anticipated this exact
 * consumer ("a future 'post a ServiceRequest' mutation"); `ProfilesModule`
 * for `ProfilesRepository` — exported by that module specifically "as a
 * forward-looking seam for future modules (ServiceRequest belongs to
 * CustomerProfile...)". `UsersModule` is ALSO imported directly here, even
 * though `IdentityVerificationModule` already imports it for its own
 * internal use: `AccountApprovedGuard` had NO real consumer anywhere in
 * this codebase before this module (its own header comment says so) — this
 * is the first time it's actually used via `@UseGuards()` from a different
 * module than the one that provides it, and Nest's guard-context resolution
 * needs `UsersRepository` (the guard's own constructor dependency)
 * resolvable from THIS module's injector too, not only
 * `IdentityVerificationModule`'s. Confirmed necessary by an e2e boot
 * failure (`Nest can't resolve dependencies of the AccountApprovedGuard`)
 * without this import.
 *
 * `LocalDevStorageAdapter` is registered as itself (a concrete provider,
 * needed directly by `UploadsController`) AND aliased to the abstract
 * `StoragePort` token via `useExisting` — same pattern
 * `IdentityVerificationModule` already uses for
 * `DiditIdentityVerificationAdapter`/`IdentityVerificationPort` — so both
 * consumers share the exact same singleton instance. Swapping in a real
 * object-storage adapter later is a new class + changing this one
 * `useExisting` target, no resolver/service/schema change.
 *
 * `UploadsController` is this module's REST controller (the codebase's
 * second, after `DiditWebhookController`) — registered via `controllers`,
 * not `providers`; NOT part of either GraphQL schema's `include` array
 * (see `app.module.ts`).
 *
 * GOS-41 follow-up — `ServiceRequestFieldResolver`
 * (`acceptedQuote`/`engagement`) needs `QuotesRepository`/
 * `EngagementsRepository`, reused here as CONCRETE provider classes,
 * deliberately NOT via importing `QuotesModule`/`EngagementsModule` (both
 * are "resolver-bearing" modules of their own) — same "reuse the concrete
 * repository class directly, never import the resolver-bearing Module"
 * pattern this file's own comment above already establishes for
 * `ProfilesRepository`. This also keeps the module graph acyclic:
 * `quotes/`/`engagements/` never import `ServiceRequestsModule` back (see
 * `quotes.module.ts`'s own comment).
 */
@Module({
  imports: [
    AuthModule,
    IdentityVerificationModule,
    ProfilesModule,
    UsersModule,
  ],
  controllers: [UploadsController],
  providers: [
    ServiceRequestsResolver,
    ServiceRequestsRepository,
    ServiceRequestFieldResolver,
    QuotesRepository,
    EngagementsRepository,
    LocalDevStorageAdapter,
    { provide: StoragePort, useExisting: LocalDevStorageAdapter },
    PublishServiceRequestService,
    CancelServiceRequestService,
    ListMyServiceRequestsService,
    ListCompatibleServiceRequestsService,
    RequestServiceRequestAttachmentUploadUrlService,
  ],
})
export class ServiceRequestsModule {}
