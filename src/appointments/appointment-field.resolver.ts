import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { EngagementStatus } from '../engagements/models/engagement-status.enum';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { AppointmentModel } from './models/appointment.model';

/**
 * GOS-125 — resolves `Appointment.engagementStatus`, the work-execution
 * lifecycle status of the `Engagement` this Appointment belongs to (GOS-111/
 * 113/114/117's `EngagementStatus`), so the Appointments/Agenda surface can
 * show it without a separate `Engagement` query. Named `engagementStatus`,
 * not `status`, to avoid any confusion with `AppointmentModel.status`
 * (the Appointment's own `AppointmentStatus`) — a different lifecycle
 * entirely.
 *
 * Injects `EngagementsRepository` DIRECTLY, as a concrete provider class —
 * same "reuse the concrete repository class directly, never import the
 * resolver-bearing Module" pattern `ServiceRequestFieldResolver` already
 * establishes (`src/appointments/appointments.module.ts` already provides
 * `EngagementsRepository` this way, for `StartEngagementWorkService`'s
 * sibling `AppointmentsRepository`-in-`EngagementsModule` reuse — this is
 * simply a second consumer of that same existing provider).
 *
 * One extra query per `Appointment` row when this field is actually
 * requested (not a batched Dataloader) — same accepted, documented "no N+1
 * mitigation added speculatively" posture as `ServiceRequestFieldResolver`.
 */
@Resolver(() => AppointmentModel)
export class AppointmentFieldResolver {
  constructor(private readonly engagementsRepository: EngagementsRepository) {}

  @ResolveField(() => EngagementStatus, {
    name: 'engagementStatus',
    description:
      "The work-execution lifecycle status of this Appointment's Engagement (ACCEPTED/IN_PROGRESS/PENDING_CUSTOMER_CONFIRMATION/COMPLETED/CANCELLED).",
  })
  async engagementStatus(
    @Parent() appointment: AppointmentModel,
  ): Promise<EngagementStatus> {
    const engagement = await this.engagementsRepository.findById(
      appointment.engagementId,
    );
    // An Appointment's `engagementId` FK is non-nullable and Cascade-deletes
    // with its Engagement — a resolved Appointment always has a live parent
    // Engagement to find, same non-null-assertion idiom the 5 transition
    // services already rely on for this same repository/method.
    return engagement!.status;
  }
}
