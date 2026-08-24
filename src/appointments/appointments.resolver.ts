import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { AppointmentsModuleEnabledGuard } from './guards/appointments-module-enabled.guard';
import { AppointmentModel } from './models/appointment.model';
import { ProposeAppointmentInput } from './models/propose-appointment-input.model';
import { AcceptAppointmentService } from './services/accept-appointment.service';
import { CancelAppointmentService } from './services/cancel-appointment.service';
import { ListAppointmentsByEngagementService } from './services/list-appointments-by-engagement.service';
import { ProposeAppointmentService } from './services/propose-appointment.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `EngagementChatResolver`. Every query/mutation requires `SessionGuard` +
 * `AccountApprovedGuard` + `AppointmentsModuleEnabledGuard`, in that exact
 * order (the module-enabled guard added as a follow-up — see that guard's
 * own header comment, `src/appointments/guards/
 * appointments-module-enabled.guard.ts`, mirroring
 * `EngagementChatResolver`'s own guard chain). No operation accepts
 * `customerProfileId`/`professionalProfileId`/`proposedByRole`/`userId` as
 * an argument — ownership/role is always derived server-side from
 * `@CurrentUser()` + `AppointmentAccessService`.
 */
@Resolver()
@UseGuards(SessionGuard, AccountApprovedGuard, AppointmentsModuleEnabledGuard)
export class AppointmentsResolver {
  constructor(
    private readonly proposeAppointmentService: ProposeAppointmentService,
    private readonly acceptAppointmentService: AcceptAppointmentService,
    private readonly cancelAppointmentService: CancelAppointmentService,
    private readonly listAppointmentsByEngagementService: ListAppointmentsByEngagementService,
  ) {}

  @Mutation(() => AppointmentModel, {
    description:
      'Proposes a visit slot (date/time) on an Engagement the caller is a party to (its CustomerProfile or ProfessionalProfile). Either party may propose — creates a new PENDING Appointment.',
  })
  proposeAppointment(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
    @Args('input') input: ProposeAppointmentInput,
  ): Promise<AppointmentModel> {
    return this.proposeAppointmentService.propose(userId, engagementId, input);
  }

  @Mutation(() => AppointmentModel, {
    description:
      "Confirms a PENDING Appointment proposed by the CALLER'S counterparty on an Engagement the caller is a party to — never the caller's own proposal. A CONFIRMED Appointment is guaranteed, at the database level, never to overlap another CONFIRMED Appointment for the same professional.",
  })
  acceptAppointment(
    @CurrentUser() userId: string,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<AppointmentModel> {
    return this.acceptAppointmentService.accept(userId, id);
  }

  @Mutation(() => AppointmentModel, {
    description:
      'Cancels an Appointment (from PENDING or CONFIRMED) on an Engagement the caller is a party to. Either party may cancel. CANCELLED is terminal.',
  })
  cancelAppointment(
    @CurrentUser() userId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
  ): Promise<AppointmentModel> {
    return this.cancelAppointmentService.cancel(userId, id, reason);
  }

  @Query(() => [AppointmentModel], {
    description:
      'Every Appointment ever proposed/confirmed/cancelled on an Engagement the caller is a party to, oldest first.',
  })
  appointmentsByEngagement(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<AppointmentModel[]> {
    return this.listAppointmentsByEngagementService.listByEngagement(
      userId,
      engagementId,
    );
  }
}
