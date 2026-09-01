import { Logger } from '@nestjs/common';
import { AppointmentParty, AppointmentStatus } from '@prisma/client';
import {
  AppointmentAccessService,
  AppointmentPartyResolution,
} from '../appointment-access.service';
import { AppointmentsRepository } from '../appointments.repository';
import { CancelAppointmentService } from './cancel-appointment.service';

describe('CancelAppointmentService', () => {
  function makeAppointment(overrides?: { status?: AppointmentStatus }) {
    return {
      id: 'appointment-1',
      engagementId: 'engagement-1',
      proposedByRole: AppointmentParty.CUSTOMER,
      status: overrides?.status ?? AppointmentStatus.PENDING,
    };
  }

  function makeParty(
    overrides?: Partial<AppointmentPartyResolution>,
  ): AppointmentPartyResolution {
    return {
      role: AppointmentParty.CUSTOMER,
      engagement: { id: 'engagement-1' } as never,
      customerProfileId: 'customer-profile-1',
      professionalProfileId: null,
      ...overrides,
    };
  }

  function makeService(overrides?: {
    appointment?: ReturnType<typeof makeAppointment> | null;
    party?: AppointmentPartyResolution | null;
    casCount?: number;
  }) {
    const appointment =
      overrides?.appointment === undefined
        ? makeAppointment()
        : overrides.appointment;
    const findById = jest.fn().mockResolvedValue(appointment);
    const cancelIfActive = jest
      .fn()
      .mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const appointmentsRepository = {
      findById,
      cancelIfActive,
    } as unknown as AppointmentsRepository;

    const tryResolveParty = jest
      .fn()
      .mockResolvedValue(
        overrides?.party === undefined ? makeParty() : overrides.party,
      );
    const accessService = {
      tryResolveParty,
    } as unknown as AppointmentAccessService;

    const service = new CancelAppointmentService(
      accessService,
      appointmentsRepository,
    );

    return { service, findById, cancelIfActive, tryResolveParty };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('cancels a PENDING Appointment (either party may cancel)', async () => {
    const { service, cancelIfActive } = makeService();

    await service.cancel('user-1', 'appointment-1', 'no longer needed');

    expect(cancelIfActive).toHaveBeenCalledWith(
      'appointment-1',
      'no longer needed',
    );
  });

  it('cancels a CONFIRMED Appointment too — either party, from PENDING or CONFIRMED', async () => {
    const { service, cancelIfActive } = makeService({
      appointment: makeAppointment({ status: AppointmentStatus.CONFIRMED }),
      party: makeParty({
        role: AppointmentParty.PROFESSIONAL,
        customerProfileId: null,
        professionalProfileId: 'professional-profile-1',
      }),
    });

    await service.cancel('user-2', 'appointment-1', 'schedule conflict');

    expect(cancelIfActive).toHaveBeenCalledWith(
      'appointment-1',
      'schedule conflict',
    );
  });

  it('throws APPOINTMENT_ALREADY_CANCELLED when the Appointment is already CANCELLED', async () => {
    const { service, cancelIfActive } = makeService({
      appointment: makeAppointment({ status: AppointmentStatus.CANCELLED }),
    });

    await expect(
      service.cancel('user-1', 'appointment-1', 'again'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_ALREADY_CANCELLED' });
    expect(cancelIfActive).not.toHaveBeenCalled();
  });

  it('throws APPOINTMENT_NOT_FOUND for a nonexistent Appointment, without resolving party', async () => {
    const { service, tryResolveParty } = makeService({ appointment: null });

    await expect(
      service.cancel('user-1', 'nope', 'reason'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
    expect(tryResolveParty).not.toHaveBeenCalled();
  });

  it('throws APPOINTMENT_NOT_FOUND (same code) for a third party not on this Engagement', async () => {
    const { service } = makeService({ party: null });

    await expect(
      service.cancel('third-party-user', 'appointment-1', 'reason'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
  });

  it('throws APPOINTMENT_CANCEL_CONFLICT when the CAS loses a race', async () => {
    const { service } = makeService({ casCount: 0 });

    await expect(
      service.cancel('user-1', 'appointment-1', 'reason'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CANCEL_CONFLICT' });
  });
});
