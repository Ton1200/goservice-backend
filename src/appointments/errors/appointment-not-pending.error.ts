import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENT_NOT_PENDING_CODE = 'APPOINTMENT_NOT_PENDING';

/**
 * Thrown by `AcceptAppointmentService`'s pre-check when the target
 * Appointment is no longer `PENDING` (already `CONFIRMED` or `CANCELLED`) —
 * a good, specific error in the common (non-race) case. The actual
 * concurrency guard is `AppointmentsRepository.confirmIfPending`'s guarded
 * CAS `updateMany` (see `appointmentAcceptConflict()` for the race-lost
 * case).
 */
export function appointmentNotPending(): DomainException {
  return new DomainException(
    APPOINTMENT_NOT_PENDING_CODE,
    'Appointment is no longer PENDING.',
  );
}
