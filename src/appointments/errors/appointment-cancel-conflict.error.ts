import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENT_CANCEL_CONFLICT_CODE = 'APPOINTMENT_CANCEL_CONFLICT';

/**
 * Thrown by `CancelAppointmentService` when
 * `AppointmentsRepository.cancelIfActive`'s guarded CAS `updateMany`
 * reports `count !== 1` — the Appointment was already `CANCELLED` by the
 * time the write actually ran (a lost race against a concurrent cancel),
 * even though the pre-read looked fine a moment earlier. Same
 * "generic, non-enumerating conflict code for a lost CAS race" idiom as
 * `appointmentAcceptConflict()`.
 */
export function appointmentCancelConflict(): DomainException {
  return new DomainException(
    APPOINTMENT_CANCEL_CONFLICT_CODE,
    'This Appointment was already cancelled by a concurrent request.',
  );
}
