import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENT_ACCEPT_CONFLICT_CODE = 'APPOINTMENT_ACCEPT_CONFLICT';

/**
 * Thrown by `AcceptAppointmentService` when
 * `AppointmentsRepository.confirmIfPending`'s guarded CAS `updateMany`
 * reports `count !== 1` — the Appointment was no longer `PENDING` by the
 * time the write actually ran (a lost race against a concurrent
 * accept/cancel), even though the pre-read looked fine a moment earlier.
 * Mirrors `quoteAcceptConflict()`/`quotePriceProposalResolveConflict()`'s
 * own "generic, non-enumerating conflict code for a lost CAS race" idiom.
 *
 * Deliberately DISTINCT from `APPOINTMENT_CONFLICT` (the DB EXCLUDE
 * violation — see `is-appointment-exclusion-violation.util.ts`): this code
 * means "someone else already resolved THIS SAME Appointment row first";
 * `APPOINTMENT_CONFLICT` means "this Appointment's requested time
 * genuinely overlaps a DIFFERENT already-CONFIRMED Appointment for the same
 * professional".
 */
export function appointmentAcceptConflict(): DomainException {
  return new DomainException(
    APPOINTMENT_ACCEPT_CONFLICT_CODE,
    'This Appointment was already resolved by a concurrent request.',
  );
}
