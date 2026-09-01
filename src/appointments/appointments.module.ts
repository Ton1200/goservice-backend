import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { AppointmentAccessService } from './appointment-access.service';
import { AppointmentsModuleEnabledGuard } from './guards/appointments-module-enabled.guard';
import { AppointmentsRepository } from './appointments.repository';
import { AppointmentsResolver } from './appointments.resolver';
import { AcceptAppointmentService } from './services/accept-appointment.service';
import { CancelAppointmentService } from './services/cancel-appointment.service';
import { ListAppointmentsByEngagementService } from './services/list-appointments-by-engagement.service';
import { ProposeAppointmentService } from './services/propose-appointment.service';

/**
 * GOS-59 — Appointment (Coordinación de Visita): propose/confirm/cancel a
 * visit slot on top of an already-`ACCEPTED` `Engagement` (GOS-41/GOS-55),
 * purely additive — never a path to mutate `Quote`/`Engagement` state.
 *
 * `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
 * need to be imported here explicitly. Imports: `AuthModule` for
 * `SessionGuard`; `IdentityVerificationModule` for `AccountApprovedGuard`;
 * `UsersModule` directly too (same reasoning as `EngagementChatModule`'s own
 * header comment: `AccountApprovedGuard` needs `UsersRepository` resolvable
 * from THIS module's injector, not only `IdentityVerificationModule`'s
 * own); `ProfilesModule` for `ProfilesRepository`.
 *
 * `EngagementsRepository` is reused here as a CONCRETE provider class (same
 * "reuse the concrete repository class directly, never import the
 * resolver-bearing Module" pattern `EngagementChatModule` already
 * establishes for the exact same repository) — `src/appointments/` never
 * imports `EngagementsModule` itself.
 *
 * `exports: [AppointmentsRepository]` — for `src/platform-admin/appointments/`'s
 * reuse, same "reuse the concrete repository class directly" pattern
 * `EngagementChatModule`/`QuoteNegotiationModule` already establish for
 * their own admin audit-surface siblings.
 *
 * **Module-enabled kill switch (follow-up round)**: `PlatformSettingsModule`
 * is now also imported, for `PlatformSettingPort` alone — the SAME
 * resolver-free module `EngagementChatModule`/`QuoteNegotiationModule`/
 * `AuthModule` already import for the same reason (see those modules' own
 * header comments) — so `AppointmentsModuleEnabledGuard` can read the
 * `customer.appointments.enabled` `PlatformSetting`.
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
    AppointmentsResolver,
    AppointmentsRepository,
    AppointmentAccessService,
    AppointmentsModuleEnabledGuard,
    EngagementsRepository,
    ProposeAppointmentService,
    AcceptAppointmentService,
    CancelAppointmentService,
    ListAppointmentsByEngagementService,
  ],
  exports: [AppointmentsRepository],
})
export class AppointmentsModule {}
