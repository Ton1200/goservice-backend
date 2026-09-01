import { Prisma } from '@prisma/client';
import { isAppointmentExclusionViolation } from './is-appointment-exclusion-violation.util';

/**
 * Hand-built fake error matching the shape EMPIRICALLY observed against
 * real `postgres_test` (see `is-appointment-exclusion-violation.util.ts`'s
 * own header comment for the full probe write-up) — a genuine
 * `Prisma.PrismaClientUnknownRequestError` whose `.message` embeds the
 * constraint name and SQLSTATE 23P01, with `.code`/`.meta` both `undefined`.
 */
function makeExclusionViolationError(): Prisma.PrismaClientUnknownRequestError {
  return new Prisma.PrismaClientUnknownRequestError(
    'Invalid `prisma.appointment.updateMany()` invocation:\n' +
      'Error occurred during query execution:\n' +
      'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError ' +
      '{ code: "23P01", message: "conflicting key value violates exclusion constraint ' +
      '\\"appointment_no_overlapping_confirmed_per_professional\\"", severity: "ERROR", ' +
      'detail: Some("Key (...) conflicts with existing key (...)."), column: None, hint: None }), transient: false })',
    { clientVersion: '6.19.3' },
  );
}

describe('isAppointmentExclusionViolation', () => {
  it('returns true for a real PrismaClientUnknownRequestError whose message embeds the EXCLUDE constraint name', () => {
    expect(isAppointmentExclusionViolation(makeExclusionViolationError())).toBe(
      true,
    );
  });

  it('returns false for a PrismaClientUnknownRequestError from an unrelated failure', () => {
    const unrelated = new Prisma.PrismaClientUnknownRequestError(
      'Some other unrelated database error occurred.',
      { clientVersion: '6.19.3' },
    );
    expect(isAppointmentExclusionViolation(unrelated)).toBe(false);
  });

  it('returns false for a PrismaClientKnownRequestError (e.g. a unique-constraint violation, P2002) — a structurally different error class', () => {
    const known = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed.',
      { code: 'P2002', clientVersion: '6.19.3' },
    );
    expect(isAppointmentExclusionViolation(known)).toBe(false);
  });

  it('returns false for a plain Error / non-Prisma value', () => {
    expect(isAppointmentExclusionViolation(new Error('boom'))).toBe(false);
    expect(isAppointmentExclusionViolation('not an error')).toBe(false);
    expect(isAppointmentExclusionViolation(null)).toBe(false);
    expect(isAppointmentExclusionViolation(undefined)).toBe(false);
  });
});
