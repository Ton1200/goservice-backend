import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { GetAdminAppointmentsByEngagementService } from './services/get-admin-appointments-by-engagement.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`),
 * same shape as `AdminEngagementChatResolver`.
 *
 * **Gated by `Permission.APPOINTMENTS_READ`** — its own dedicated
 * permission (NOT `SERVICE_REQUESTS_READ`/`QUOTE_NEGOTIATION_READ`/
 * `ENGAGEMENT_CHAT_READ` — see the `Permission` enum's own comment in
 * `prisma/schema.prisma` for the rationale).
 *
 * **Deliberately NOT gated by `customer.appointments.enabled`
 * (`AppointmentsModuleEnabledGuard`)** — the follow-up round that added that
 * kill switch to the CONSUMER `AppointmentsResolver` explicitly left this
 * admin audit query ungated, per its own instruction. Same reasoning
 * `AdminEngagementChatResolver`'s own header comment documents for its
 * sibling surface (an admin's ability to audit existing history shouldn't
 * disappear just because the client-facing capability was toggled off) —
 * NOT `AdminQuoteNegotiationResolver`'s precedent, which reversed that
 * reasoning for its own feature per a separate, feature-specific human
 * decision not requested here. See `AppointmentsModuleEnabledGuard`'s own
 * header comment (`src/appointments/guards/
 * appointments-module-enabled.guard.ts`) for the other half of this
 * decision.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminAppointmentsResolver {
  constructor(
    private readonly getAdminAppointmentsByEngagementService: GetAdminAppointmentsByEngagementService,
  ) {}

  @RequireAdminPermissions(Permission.APPOINTMENTS_READ)
  @Query(() => [AppointmentModel], {
    description:
      'Full Appointment history for one Engagement (proposed/confirmed/cancelled alike) — an audit/support read-only view. Gated by APPOINTMENTS_READ, its own dedicated permission.',
  })
  adminAppointmentsByEngagement(
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<AppointmentModel[]> {
    return this.getAdminAppointmentsByEngagementService.getAppointments(
      engagementId,
    );
  }
}
