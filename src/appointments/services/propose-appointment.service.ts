import { Injectable, Logger } from '@nestjs/common';
import { AppointmentModel } from '../models/appointment.model';
import { ProposeAppointmentInput } from '../models/propose-appointment-input.model';
import { AppointmentAccessService } from '../appointment-access.service';
import { AppointmentsRepository } from '../appointments.repository';
import { appointmentInvalidTimeRange } from '../errors/appointment-invalid-time-range.error';

/**
 * Orchestrates `Mutation.proposeAppointment` — either party on the
 * Engagement (Customer or Professional) may propose a slot (confirmed
 * product decision, mirrors `QuoteNegotiationMessage`'s dual-role pattern).
 * Resolves the caller's party via `AppointmentAccessService` (never trusts
 * a client-supplied role/profile id).
 *
 * `endsAt > startsAt` is validated here (`appointmentInvalidTimeRange()`) —
 * defense-in-depth alongside the DB-level `appointment_time_range_check`
 * CHECK constraint (see the migration), same "good, specific error at the
 * application layer" posture as every other pre-check in this codebase.
 *
 * A single, ungated `create` — unlike `AcceptAppointmentService`/
 * `CancelAppointmentService`, there is no CAS here: creating a new
 * `PENDING` Appointment can never conflict with anything (the `EXCLUDE`
 * constraint only applies to `CONFIRMED` rows — see the migration), and
 * `engagementId` is deliberately NOT `@unique`, so an Engagement may
 * accumulate several Appointment rows over its life.
 */
@Injectable()
export class ProposeAppointmentService {
  private readonly logger = new Logger(ProposeAppointmentService.name);

  constructor(
    private readonly accessService: AppointmentAccessService,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async propose(
    userId: string,
    engagementId: string,
    input: ProposeAppointmentInput,
  ): Promise<AppointmentModel> {
    if (input.endsAt <= input.startsAt) {
      throw appointmentInvalidTimeRange();
    }

    const party = await this.accessService.resolveParty(userId, engagementId);

    const appointment = await this.appointmentsRepository.create({
      engagementId,
      professionalProfileId: party.engagement.professionalProfileId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      proposedByRole: party.role,
      proposedByCustomerProfileId: party.customerProfileId,
      proposedByProfessionalProfileId: party.professionalProfileId,
    });

    this.logger.log({
      event: 'appointment_proposed',
      outcome: 'success',
      engagementId,
      appointmentId: appointment.id,
    });

    return appointment;
  }
}
