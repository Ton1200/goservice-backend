import { EngagementStatus } from '@prisma/client';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { AppointmentFieldResolver } from './appointment-field.resolver';
import { AppointmentModel } from './models/appointment.model';

describe('AppointmentFieldResolver (engagementStatus)', () => {
  function makeAppointment(
    overrides?: Partial<AppointmentModel>,
  ): AppointmentModel {
    const appointment = new AppointmentModel();
    appointment.id = 'appointment-1';
    appointment.engagementId = 'engagement-1';
    Object.assign(appointment, overrides);
    return appointment;
  }

  function makeResolver(status: EngagementStatus) {
    const findById = jest.fn().mockResolvedValue({
      id: 'engagement-1',
      status,
    });
    const engagementsRepository = {
      findById,
    } as unknown as EngagementsRepository;

    return {
      resolver: new AppointmentFieldResolver(engagementsRepository),
      findById,
    };
  }

  it("resolves the parent Engagement's current status via its engagementId", async () => {
    const { resolver, findById } = makeResolver(EngagementStatus.IN_PROGRESS);
    const appointment = makeAppointment();

    const status = await resolver.engagementStatus(appointment);

    expect(findById).toHaveBeenCalledWith('engagement-1');
    expect(status).toBe(EngagementStatus.IN_PROGRESS);
  });

  it('reflects whatever the current Engagement status is (e.g. CANCELLED)', async () => {
    const { resolver } = makeResolver(EngagementStatus.CANCELLED);

    const status = await resolver.engagementStatus(makeAppointment());

    expect(status).toBe(EngagementStatus.CANCELLED);
  });
});
