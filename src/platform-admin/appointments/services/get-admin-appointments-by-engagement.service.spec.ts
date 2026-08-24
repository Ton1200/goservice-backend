import { EngagementsRepository } from '../../../engagements/engagements.repository';
import { AppointmentsRepository } from '../../../appointments/appointments.repository';
import { GetAdminAppointmentsByEngagementService } from './get-admin-appointments-by-engagement.service';

describe('GetAdminAppointmentsByEngagementService', () => {
  function makeService(overrides?: { engagement?: { id: string } | null }) {
    const engagement =
      overrides?.engagement === undefined
        ? { id: 'engagement-1' }
        : overrides.engagement;
    const findById = jest.fn().mockResolvedValue(engagement);
    const engagementsRepository = {
      findById,
    } as unknown as EngagementsRepository;

    const appointments = [
      {
        id: 'appointment-1',
        engagementId: 'engagement-1',
        status: 'PENDING',
      },
    ];
    const findManyByEngagementId = jest.fn().mockResolvedValue(appointments);
    const appointmentsRepository = {
      findManyByEngagementId,
    } as unknown as AppointmentsRepository;

    const service = new GetAdminAppointmentsByEngagementService(
      engagementsRepository,
      appointmentsRepository,
    );

    return { service, findById, findManyByEngagementId, appointments };
  }

  it('returns the full Appointment history for an existing Engagement — this is the admin-schema surface APPOINTMENTS_READ gates; the permission check itself is enforced generically by AdminPermissionsGuard/RequireAdminPermissions, exercised in admin-permissions.guard.spec.ts', async () => {
    const { service, findManyByEngagementId, appointments } = makeService();

    const result = await service.getAppointments('engagement-1');

    expect(findManyByEngagementId).toHaveBeenCalledWith('engagement-1');
    expect(result).toBe(appointments);
  });

  it('throws ADMIN_ENGAGEMENT_NOT_FOUND for a nonexistent Engagement', async () => {
    const { service, findManyByEngagementId } = makeService({
      engagement: null,
    });

    await expect(service.getAppointments('nope')).rejects.toMatchObject({
      code: 'ADMIN_ENGAGEMENT_NOT_FOUND',
    });
    expect(findManyByEngagementId).not.toHaveBeenCalled();
  });
});
