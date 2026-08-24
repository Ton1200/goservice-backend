import { Injectable } from '@nestjs/common';
import { AppointmentModel } from '../models/appointment.model';
import { AppointmentAccessService } from '../appointment-access.service';
import { AppointmentsRepository } from '../appointments.repository';

/**
 * Orchestrates `Query.appointmentsByEngagement` — every Appointment ever
 * proposed/confirmed/cancelled on an Engagement the caller is a party to,
 * oldest first. `AppointmentAccessService.resolveParty` is used purely as
 * an ownership check here (its resolved role isn't otherwise needed) — same
 * "resolve party as an ownership check, then list" shape as
 * `ListEngagementMessagesService`.
 */
@Injectable()
export class ListAppointmentsByEngagementService {
  constructor(
    private readonly accessService: AppointmentAccessService,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async listByEngagement(
    userId: string,
    engagementId: string,
  ): Promise<AppointmentModel[]> {
    await this.accessService.resolveParty(userId, engagementId);
    return this.appointmentsRepository.findManyByEngagementId(engagementId);
  }
}
