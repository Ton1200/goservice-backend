import { Module } from '@nestjs/common';
import { AppointmentsRepository } from '../appointments/appointments.repository';
import { AuthModule } from '../auth/auth.module';
import { EngagementChatRepository } from '../engagement-chat/engagement-chat.repository';
import { EmitEngagementLifecycleSystemMessageService } from '../engagement-chat/services/emit-engagement-lifecycle-system-message.service';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { EngagementsRepository } from './engagements.repository';
import { EngagementsResolver } from './engagements.resolver';
import { CancelEngagementByCustomerService } from './services/cancel-engagement-by-customer.service';
import { CancelEngagementByProfessionalService } from './services/cancel-engagement-by-professional.service';
import { ConfirmEngagementCompletionService } from './services/confirm-engagement-completion.service';
import { ListMyEngagementsAsCustomerService } from './services/list-my-engagements-as-customer.service';
import { ListMyEngagementsAsProfessionalService } from './services/list-my-engagements-as-professional.service';
import { MarkEngagementWorkFinishedService } from './services/mark-engagement-work-finished.service';
import { ReportEngagementNoShowService } from './services/report-engagement-no-show.service';
import { StartEngagementWorkService } from './services/start-engagement-work.service';

/**
 * `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
 * need to be imported here explicitly.
 *
 * Imports: `AuthModule` for `SessionGuard`; `IdentityVerificationModule`
 * for `AccountApprovedGuard`; `UsersModule` directly too (same reasoning as
 * `ServiceRequestsModule`'s own header comment: `AccountApprovedGuard`
 * needs `UsersRepository` resolvable from THIS module's injector, not only
 * `IdentityVerificationModule`'s own); `ProfilesModule` for
 * `ProfilesRepository`.
 *
 * `AppointmentsRepository` is listed directly in `providers` (a second,
 * stateless instance — it injects only the `@Global()` `PrismaService`) so
 * `StartEngagementWorkService` can check "does this Engagement have a
 * CONFIRMED Appointment" without importing `AppointmentsModule` — same
 * "reuse the concrete repository class, never the resolver-bearing module"
 * rule this comment already states, and the mirror image of
 * `AppointmentsModule` already listing `EngagementsRepository` in its own
 * providers.
 *
 * **GOS-125**: `EngagementChatRepository`/`EmitEngagementLifecycleSystemMessageService`
 * are ALSO listed directly here, as concrete provider classes — same
 * "reuse the concrete repository/service class directly, never import the
 * resolver-bearing Module" rule as `AppointmentsRepository` above, mirrored
 * the other way: `EngagementChatModule` already reuses `EngagementsRepository`
 * this same way. Every one of the 5 lifecycle-transition services below
 * calls `EmitEngagementLifecycleSystemMessageService.emit(tx, ...)` from
 * inside its own `prisma.$transaction`, right after its guarded CAS status
 * write succeeds. `EngagementChatRepository` depends only on the `@Global()`
 * `PrismaService`, so this introduces no import cycle.
 *
 * **GOS-109**: `LedgerModule` is imported (not reused as a bare provider
 * class) for `RecordCustomerCancellationChargeService`/
 * `RecordProfessionalCancellationRefundService` — both exported by that
 * module, which is deliberately resolver-free (same "safe to import
 * directly" reasoning as `PlatformSettingsModule`). `CancelEngagementByCustomerService`/
 * `CancelEngagementByProfessionalService` each call their respective ledger
 * service from INSIDE their own `prisma.$transaction`, replacing the two
 * former always-`null` stubs (`computeCustomerCancellationCharge`/
 * `recordProfessionalCancellationRefund`).
 *
 * Deliberately does NOT import `ServiceRequestsModule` or `QuotesModule` —
 * this module is a lean, leaf "repository + GraphQL type + read queries"
 * module, reused by BOTH `quotes/` (`AcceptQuoteService`, via
 * `EngagementsRepository` exported below) and `service-requests/`
 * (`ServiceRequestFieldResolver`, same export) without either of them
 * pulling in this module's own resolver as a side effect — same "reuse the
 * concrete repository class directly, never import the resolver-bearing
 * Module" pattern already established elsewhere in this codebase (see
 * `service-requests.module.ts`'s own comment). This also gives a future
 * Chat/Notifications module (see goservice-docs/product/roadmap.md) a
 * clean import point without dragging in all of `quotes/`.
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
    EngagementsResolver,
    EngagementsRepository,
    AppointmentsRepository,
    ListMyEngagementsAsCustomerService,
    ListMyEngagementsAsProfessionalService,
    StartEngagementWorkService,
    MarkEngagementWorkFinishedService,
    ConfirmEngagementCompletionService,
    CancelEngagementByCustomerService,
    CancelEngagementByProfessionalService,
    ReportEngagementNoShowService,
    // GOS-125
    EngagementChatRepository,
    EmitEngagementLifecycleSystemMessageService,
  ],
  exports: [EngagementsRepository],
})
export class EngagementsModule {}
