import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENT_INVALID_TIME_RANGE_CODE = 'APPOINTMENT_INVALID_TIME_RANGE';

/**
 * Thrown by `ProposeAppointmentService` when `endsAt <= startsAt` —
 * defense-in-depth alongside the DB-level
 * `appointment_time_range_check` CHECK constraint (see the migration): a
 * good, specific error at the application layer, not a raw Postgres
 * constraint-violation error surfacing to the client.
 */
export function appointmentInvalidTimeRange(): DomainException {
  return new DomainException(
    APPOINTMENT_INVALID_TIME_RANGE_CODE,
    'endsAt must be after startsAt.',
  );
}
