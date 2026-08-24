import { Injectable, Logger } from '@nestjs/common';
import { AppointmentModel } from '../models/appointment.model';
import { AppointmentAccessService } from '../appointment-access.service';
import { AppointmentsRepository } from '../appointments.repository';
import { appointmentAlreadyCancelled } from '../errors/appointment-already-cancelled.error';
import { appointmentCancelConflict } from '../errors/appointment-cancel-conflict.error';
import { appointmentNotFound } from '../errors/appointment-not-found.error';

/**
 * Orchestrates `Mutation.cancelAppointment` — NOT fully specified by the
 * ticket itself; documented, human-confirmed default: either party (the
 * proposer OR the counterparty) may cancel, from `PENDING` OR `CONFIRMED`.
 * `CANCELLED` is terminal — a second cancel attempt gets
 * `appointmentAlreadyCancelled()`, never silently succeeds again.
 *
 * Ordering of checks, same shape as `AcceptAppointmentService`: (1)
 * Appointment exists (`appointmentNotFound()`); (2) caller is a party to
 * its Engagement (same anti-enumeration code as (1) when the caller isn't a
 * party); (3) Appointment is not already `CANCELLED`
 * (`appointmentAlreadyCancelled()`).
 *
 * The actual concurrency guard is
 * `AppointmentsRepository.cancelIfActive`'s guarded CAS `updateMany`
 * (`count !== 1` -> `appointmentCancelConflict()`, a lost race against a
 * concurrent cancel/accept). Never touches the `EXCLUDE` constraint — see
 * that repository method's own header comment.
 */
@Injectable()
export class CancelAppointmentService {
  private readonly logger = new Logger(CancelAppointmentService.name);

  constructor(
    private readonly accessService: AppointmentAccessService,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async cancel(
    userId: string,
    appointmentId: string,
    reason: string,
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
      throw appointmentNotFound();
    }

    if (appointment.status === 'CANCELLED') {
      throw appointmentAlreadyCancelled();
    }

    const cas = await this.appointmentsRepository.cancelIfActive(
      appointmentId,
      reason,
    );
    if (cas.count !== 1) {
      throw appointmentCancelConflict();
    }

    const cancelled = await this.appointmentsRepository.findById(appointmentId);

    this.logger.log({
      event: 'appointment_cancelled',
      outcome: 'success',
      engagementId: appointment.engagementId,
      appointmentId: appointment.id,
    });

    return cancelled!;
  }
}
