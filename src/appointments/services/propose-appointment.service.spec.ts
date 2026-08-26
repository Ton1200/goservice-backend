import { Logger } from '@nestjs/common';
import { AppointmentParty } from '@prisma/client';
import {
  AppointmentAccessService,
  AppointmentPartyResolution,
} from '../appointment-access.service';
import { AppointmentsRepository } from '../appointments.repository';
import { ProposeAppointmentService } from './propose-appointment.service';

describe('ProposeAppointmentService', () => {
  function makeParty(
    overrides?: Partial<AppointmentPartyResolution>,
  ): AppointmentPartyResolution {
    return {
      role: AppointmentParty.CUSTOMER,
      engagement: {
        id: 'engagement-1',
        professionalProfileId: 'professional-profile-1',
      } as never,
      customerProfileId: 'customer-profile-1',
      professionalProfileId: null,
      ...overrides,
    };
  }

  function makeService(overrides?: { party?: AppointmentPartyResolution }) {
    const resolveParty = jest
      .fn()
      .mockResolvedValue(overrides?.party ?? makeParty());
    const accessService = {
      resolveParty,
    } as unknown as AppointmentAccessService;

    const createdAppointment = {
      id: 'appointment-1',
      engagementId: 'engagement-1',
      status: 'PENDING',
    };
    const create = jest.fn().mockResolvedValue(createdAppointment);
    const appointmentsRepository = {
      create,
    } as unknown as AppointmentsRepository;

    const service = new ProposeAppointmentService(
      accessService,
      appointmentsRepository,
    );

    return { service, resolveParty, create, createdAppointment };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('creates a PENDING Appointment proposed by the resolved CUSTOMER party', async () => {
    const { service, create } = makeService();

    const result = await service.propose('user-1', 'engagement-1', {
      startsAt: new Date('2026-09-01T10:00:00'),
      endsAt: new Date('2026-09-01T12:00:00'),
    });

    expect(create).toHaveBeenCalledWith({
      engagementId: 'engagement-1',
      professionalProfileId: 'professional-profile-1',
      startsAt: new Date('2026-09-01T10:00:00'),
      endsAt: new Date('2026-09-01T12:00:00'),
      proposedByRole: AppointmentParty.CUSTOMER,
      proposedByCustomerProfileId: 'customer-profile-1',
      proposedByProfessionalProfileId: null,
    });
    expect(result.id).toBe('appointment-1');
  });

  it('creates a PENDING Appointment proposed by the resolved PROFESSIONAL party', async () => {
    const { service, create } = makeService({
      party: makeParty({
        role: AppointmentParty.PROFESSIONAL,
        customerProfileId: null,
        professionalProfileId: 'professional-profile-1',
      }),
    });

    await service.propose('user-2', 'engagement-1', {
      startsAt: new Date('2026-09-01T10:00:00'),
      endsAt: new Date('2026-09-01T12:00:00'),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        proposedByRole: AppointmentParty.PROFESSIONAL,
        proposedByCustomerProfileId: null,
        proposedByProfessionalProfileId: 'professional-profile-1',
      }),
    );
  });

  it('throws APPOINTMENT_INVALID_TIME_RANGE when endsAt <= startsAt, without resolving party or creating', async () => {
    const { service, resolveParty, create } = makeService();

    await expect(
      service.propose('user-1', 'engagement-1', {
        startsAt: new Date('2026-09-01T12:00:00'),
        endsAt: new Date('2026-09-01T10:00:00'),
      }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_INVALID_TIME_RANGE' });
    expect(resolveParty).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('throws APPOINTMENT_INVALID_TIME_RANGE when endsAt === startsAt', async () => {
    const { service } = makeService();
    const same = new Date('2026-09-01T10:00:00');

    await expect(
      service.propose('user-1', 'engagement-1', {
        startsAt: same,
        endsAt: same,
      }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_INVALID_TIME_RANGE' });
  });

  it('propagates ENGAGEMENT_NOT_FOUND from AppointmentAccessService for a third party', async () => {
    const resolveParty = jest.fn().mockRejectedValue(
      Object.assign(new Error('Engagement not found.'), {
        code: 'ENGAGEMENT_NOT_FOUND',
      }),
    );
    const accessService = {
      resolveParty,
    } as unknown as AppointmentAccessService;
    const create = jest.fn();
    const appointmentsRepository = {
      create,
    } as unknown as AppointmentsRepository;
    const service = new ProposeAppointmentService(
      accessService,
      appointmentsRepository,
    );

    await expect(
      service.propose('third-party-user', 'engagement-1', {
        startsAt: new Date('2026-09-01T10:00:00'),
        endsAt: new Date('2026-09-01T12:00:00'),
      }),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect(create).not.toHaveBeenCalled();
  });
});
