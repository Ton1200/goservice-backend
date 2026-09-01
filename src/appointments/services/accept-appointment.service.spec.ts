import { Logger } from '@nestjs/common';
import { AppointmentParty, AppointmentStatus } from '@prisma/client';
import {
  AppointmentAccessService,
  AppointmentPartyResolution,
} from '../appointment-access.service';
import { AppointmentsRepository } from '../appointments.repository';
import { AcceptAppointmentService } from './accept-appointment.service';

describe('AcceptAppointmentService', () => {
  function makeAppointment(
    overrides?: Partial<{
      status: AppointmentStatus;
      proposedByRole: AppointmentParty;
    }>,
  ) {
    return {
      id: 'appointment-1',
      engagementId: 'engagement-1',
      proposedByRole: overrides?.proposedByRole ?? AppointmentParty.CUSTOMER,
      status: overrides?.status ?? AppointmentStatus.PENDING,
    };
  }

  function makeParty(
    overrides?: Partial<AppointmentPartyResolution>,
  ): AppointmentPartyResolution {
    return {
      role: AppointmentParty.PROFESSIONAL,
      engagement: { id: 'engagement-1' } as never,
      customerProfileId: null,
      professionalProfileId: 'professional-profile-1',
      ...overrides,
    };
  }

  function makeService(overrides?: {
    appointment?: ReturnType<typeof makeAppointment> | null;
    party?: AppointmentPartyResolution | null;
    casCount?: number;
    confirmError?: unknown;
  }) {
    const appointment =
      overrides?.appointment === undefined
        ? makeAppointment()
        : overrides.appointment;
    const findById = jest.fn().mockResolvedValue(appointment);
    const confirmIfPending = overrides?.confirmError
      ? jest.fn().mockRejectedValue(overrides.confirmError)
      : jest.fn().mockResolvedValue({ count: overrides?.casCount ?? 1 });
    const appointmentsRepository = {
      findById,
      confirmIfPending,
    } as unknown as AppointmentsRepository;

    const tryResolveParty = jest
      .fn()
      .mockResolvedValue(
        overrides?.party === undefined ? makeParty() : overrides.party,
      );
    const accessService = {
      tryResolveParty,
    } as unknown as AppointmentAccessService;

    const service = new AcceptAppointmentService(
      accessService,
      appointmentsRepository,
    );

    return { service, findById, confirmIfPending, tryResolveParty };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("confirms the counterparty's PENDING Appointment (CAS PENDING -> CONFIRMED)", async () => {
    const { service, confirmIfPending } = makeService();

    await service.accept('user-1', 'appointment-1');

    expect(confirmIfPending).toHaveBeenCalledWith('appointment-1');
  });

  it('throws APPOINTMENT_CANNOT_ACCEPT_OWN_PROPOSAL when the caller is the proposer, without calling the CAS', async () => {
    const { service, confirmIfPending } = makeService({
      party: makeParty({ role: AppointmentParty.CUSTOMER }),
      appointment: makeAppointment({
        proposedByRole: AppointmentParty.CUSTOMER,
      }),
    });

    await expect(
      service.accept('user-1', 'appointment-1'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CANNOT_ACCEPT_OWN_PROPOSAL' });
    expect(confirmIfPending).not.toHaveBeenCalled();
  });

  it('throws APPOINTMENT_NOT_PENDING when the Appointment is no longer PENDING', async () => {
    const { service, confirmIfPending } = makeService({
      appointment: makeAppointment({ status: AppointmentStatus.CANCELLED }),
    });

    await expect(
      service.accept('user-1', 'appointment-1'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_PENDING' });
    expect(confirmIfPending).not.toHaveBeenCalled();
  });

  it('throws APPOINTMENT_NOT_FOUND for a nonexistent Appointment, without resolving party', async () => {
    const { service, tryResolveParty } = makeService({ appointment: null });

    await expect(service.accept('user-1', 'nope')).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    });
    expect(tryResolveParty).not.toHaveBeenCalled();
  });

  it('throws APPOINTMENT_NOT_FOUND (same code) for a third party not on this Engagement', async () => {
    const { service } = makeService({ party: null });

    await expect(
      service.accept('third-party-user', 'appointment-1'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
  });

  it('throws APPOINTMENT_ACCEPT_CONFLICT when the CAS loses a race (count 0, no thrown error)', async () => {
    const { service } = makeService({ casCount: 0 });

    await expect(
      service.accept('user-1', 'appointment-1'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_ACCEPT_CONFLICT' });
  });

  it('propagates APPOINTMENT_CONFLICT thrown directly by the repository (a real DB EXCLUDE violation)', async () => {
    const conflictError = Object.assign(new Error('conflict'), {
      code: 'APPOINTMENT_CONFLICT',
    });
    const { service } = makeService({ confirmError: conflictError });

    await expect(
      service.accept('user-1', 'appointment-1'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CONFLICT' });
  });
});
