import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENT_CONFLICT_CODE = 'APPOINTMENT_CONFLICT';

/**
 * THE AC-mandated code. Thrown by
 * `AppointmentsRepository.confirmIfPending` when the CAS `updateMany`
 * itself fails with a real Postgres exclusion-constraint violation
 * (SQLSTATE 23P01 on `appointment_no_overlapping_confirmed_per_professional`
 * — see the migration and `is-appointment-exclusion-violation.util.ts`'s own
 * header comment for the empirically-observed error shape this is matched
 * against) — the requested time genuinely overlaps a DIFFERENT
 * already-CONFIRMED Appointment for the same professional. Deliberately
 * DISTINCT from `APPOINTMENT_ACCEPT_CONFLICT` (a lost CAS race on THIS SAME
 * Appointment row) — see that error's own header comment for the
 * disambiguation. Never a raw/technical Postgres error reaching the
 * client.
 */
export function appointmentConflict(): DomainException {
  return new DomainException(
    APPOINTMENT_CONFLICT_CODE,
    'This time slot overlaps an already-confirmed Appointment for this professional.',
  );
}
