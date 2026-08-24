import { Injectable } from '@nestjs/common';
import { EngagementsRepository } from '../../../engagements/engagements.repository';
import { AppointmentsRepository } from '../../../appointments/appointments.repository';
import { AppointmentModel } from '../../../appointments/models/appointment.model';
import { adminEngagementNotFound } from '../../engagement-chat/errors/admin-engagement.errors';

/**
 * Orchestrates `Query.adminAppointmentsByEngagement` — the admin panel's
 * read-only audit view of an Engagement's full Appointment history
 * (proposed/confirmed/cancelled alike): every Appointment row, in order.
 * Reuses `AppointmentModel` (`src/appointments/models/`) DIRECTLY as this
 * query's return type, rather than a separate `AdminAppointment`-named
 * duplicate — same "orphaned type made reachable" reasoning
 * `GetAdminEngagementChatThreadService`'s own header comment already
 * documents for its sibling admin surface. Reuses the SAME
 * `adminEngagementNotFound()` (from
 * `platform-admin/engagement-chat/errors/`) that sibling surface already
 * defines — same "does this Engagement exist" lookup, not duplicated.
 */
@Injectable()
export class GetAdminAppointmentsByEngagementService {
  constructor(
    private readonly engagementsRepository: EngagementsRepository,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async getAppointments(engagementId: string): Promise<AppointmentModel[]> {
    const engagement = await this.engagementsRepository.findById(engagementId);
    if (!engagement) {
      throw adminEngagementNotFound(engagementId);
    }
    return this.appointmentsRepository.findManyByEngagementId(engagementId);
  }
}
