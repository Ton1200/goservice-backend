import { AppointmentParty } from '@prisma/client';
import {
  AppointmentAccessService,
  AppointmentPartyResolution,
} from '../appointment-access.service';
import { AppointmentsRepository } from '../appointments.repository';
import { ListAppointmentsByEngagementService } from './list-appointments-by-engagement.service';

describe('ListAppointmentsByEngagementService', () => {
  function makeParty(): AppointmentPartyResolution {
    return {
      role: AppointmentParty.CUSTOMER,
      engagement: { id: 'engagement-1' } as never,
      customerProfileId: 'customer-profile-1',
      professionalProfileId: null,
    };
  }

  it('resolves party as an ownership check, then lists every Appointment on the Engagement, oldest first', async () => {
    const appointments = [{ id: 'appointment-1' }, { id: 'appointment-2' }];
    const resolveParty = jest.fn().mockResolvedValue(makeParty());
    const accessService = {
      resolveParty,
    } as unknown as AppointmentAccessService;
    const findManyByEngagementId = jest.fn().mockResolvedValue(appointments);
    const appointmentsRepository = {
      findManyByEngagementId,
    } as unknown as AppointmentsRepository;

    const service = new ListAppointmentsByEngagementService(
      accessService,
      appointmentsRepository,
    );

    const result = await service.listByEngagement('user-1', 'engagement-1');

    expect(resolveParty).toHaveBeenCalledWith('user-1', 'engagement-1');
    expect(findManyByEngagementId).toHaveBeenCalledWith('engagement-1');
    expect(result).toBe(appointments);
  });

  it('propagates ENGAGEMENT_NOT_FOUND for a third party, without listing', async () => {
    const resolveParty = jest.fn().mockRejectedValue(
      Object.assign(new Error('Engagement not found.'), {
        code: 'ENGAGEMENT_NOT_FOUND',
      }),
    );
    const accessService = {
      resolveParty,
    } as unknown as AppointmentAccessService;
    const findManyByEngagementId = jest.fn();
    const appointmentsRepository = {
      findManyByEngagementId,
    } as unknown as AppointmentsRepository;

    const service = new ListAppointmentsByEngagementService(
      accessService,
      appointmentsRepository,
    );

    await expect(
      service.listByEngagement('third-party-user', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect(findManyByEngagementId).not.toHaveBeenCalled();
  });
});
