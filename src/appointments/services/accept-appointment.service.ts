import { Injectable, Logger } from '@nestjs/common';
import { AppointmentModel } from '../models/appointment.model';
import { AppointmentAccessService } from '../appointment-access.service';
import { AppointmentsRepository } from '../appointments.repository';
import { appointmentAcceptConflict } from '../errors/appointment-accept-conflict.error';
import { appointmentCannotAcceptOwnProposal } from '../errors/appointment-cannot-accept-own-proposal.error';
import { appointmentNotFound } from '../errors/appointment-not-found.error';
import { appointmentNotPending } from '../errors/appointment-not-pending.error';

/**
 * Orchestrates `Mutation.acceptAppointment` — confirmed product decision:
 * ONLY the party that did NOT propose the Appointment may accept it (never
 * the proposer itself — `appointmentCannotAcceptOwnProposal()`).
 *
 * Ordering of checks (all before the CAS write, for a good specific error
 * in the common case): (1) Appointment exists
 * (`appointmentNotFound()`); (2) caller is a party to its Engagement
 * (`AppointmentAccessService.tryResolveParty`, same anti-enumeration code
 * as (1) when the caller isn't a party); (3) caller is NOT the
 * Appointment's own proposer (`appointmentCannotAcceptOwnProposal()` —
 * checked BEFORE the state check below, so a self-attempt gets this
 * specific error regardless of the Appointment's current state); (4)
 * Appointment is still `PENDING` (`appointmentNotPending()`).
 *
 * The actual concurrency guard is
 * `AppointmentsRepository.confirmIfPending`'s guarded CAS `updateMany`,
 * which may itself throw `APPOINTMENT_CONFLICT` (a real DB `EXCLUDE`
 * violation — a DIFFERENT already-`CONFIRMED` Appointment for the same
 * professional genuinely overlaps) or report `count !== 1`
 * (`appointmentAcceptConflict()` — a lost race on THIS SAME row, e.g. a
 * concurrent cancel).
 */
@Injectable()
export class AcceptAppointmentService {
  private readonly logger = new Logger(AcceptAppointmentService.name);

  constructor(
    private readonly accessService: AppointmentAccessService,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async accept(
    userId: string,
    appointmentId: string,
  ): Promise<AppointmentModel> {
    const appointment =
      await this.appointmentsRepository.findById(appointmentId);
    if (!appointment) {
      throw appointmentNotFound();
    }

    const party = await this.accessService.tryResolveParty(
      userId,
      appointment.engagementId,
    );
    if (!party) {
      // Same anti-enumeration code as the "no such Appointment" case above
      // — a caller who isn't a party to this Appointment's Engagement must
      // never be able to distinguish "no such Appointment" from "not
      // yours".
      throw appointmentNotFound();
    }

    if (party.role === appointment.proposedByRole) {
      throw appointmentCannotAcceptOwnProposal();
    }
    if (appointment.status !== 'PENDING') {
      throw appointmentNotPending();
    }

    // Throws APPOINTMENT_CONFLICT itself on a real EXCLUDE violation — see
    // AppointmentsRepository.confirmIfPending's own header comment.
    const cas =
      await this.appointmentsRepository.confirmIfPending(appointmentId);
    if (cas.count !== 1) {
      throw appointmentAcceptConflict();
    }

    const confirmed = await this.appointmentsRepository.findById(appointmentId);

    this.logger.log({
      event: 'appointment_accepted',
      outcome: 'success',
      engagementId: appointment.engagementId,
      appointmentId: appointment.id,
    });

    return confirmed!;
  }
}
