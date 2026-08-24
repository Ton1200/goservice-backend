import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENT_ALREADY_CANCELLED_CODE = 'APPOINTMENT_ALREADY_CANCELLED';

/**
 * Thrown by `CancelAppointmentService`'s pre-check when the target
 * Appointment is already `CANCELLED` — a good, specific error in the
 * common (non-race) case. The actual concurrency guard is
 * `AppointmentsRepository.cancelIfActive`'s guarded CAS `updateMany` (see
 * `appointmentCancelConflict()` for the race-lost case).
 */
export function appointmentAlreadyCancelled(): DomainException {
  return new DomainException(
    APPOINTMENT_ALREADY_CANCELLED_CODE,
    'Appointment is already cancelled.',
  );
}
