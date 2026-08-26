import { Prisma } from '@prisma/client';

const EXCLUSION_CONSTRAINT_NAME =
  'appointment_no_overlapping_confirmed_per_professional';

/**
 * Detects a raw Postgres EXCLUDE-constraint violation (SQLSTATE 23P01 on
 * `appointment_no_overlapping_confirmed_per_professional` — see the
 * migration) surfacing from a Prisma `updateMany` call, so
 * `AppointmentsRepository.confirmIfPending` can translate it into the
 * AC-mandated `APPOINTMENT_CONFLICT` domain error instead of letting a raw
 * technical error reach the GraphQL client.
 *
 * **EMPIRICALLY OBSERVED SHAPE (not a guess)** — there was no existing
 * precedent in this codebase for catching a raw Postgres constraint
 * violation from a normal (non-`$queryRaw`) Prisma call, so this was
 * resolved by writing a standalone probe script that ran the exact
 * `updateMany` this repository issues against real `postgres_test`, with a
 * genuinely conflicting row already `CONFIRMED`, and inspecting the actual
 * thrown error:
 *
 *   - `error instanceof Prisma.PrismaClientUnknownRequestError` — TRUE.
 *     NOT a `Prisma.PrismaClientKnownRequestError` (the class that carries
 *     a `.code` like `'P2002'` for unique-constraint violations) — an
 *     `EXCLUDE` constraint is not one of the constraint types Prisma's
 *     query engine recognizes and maps to a known error code.
 *   - `error.code` — `undefined`.
 *   - `error.meta` — `undefined`.
 *   - `error.message` — a raw connector-error string that DOES embed the
 *     Postgres `SQLSTATE` and the constraint name verbatim, e.g.:
 *     `... PostgresError { code: "23P01", message: "conflicting key value
 *     violates exclusion constraint
 *     \"appointment_no_overlapping_confirmed_per_professional\"", ... }`.
 *
 * Since `.code`/`.meta` are unusable here, detection is a substring match
 * on `.message` for the constraint's own name — the safe fallback the
 * implementation plan itself anticipated for exactly this case, and the
 * most specific/least-false-positive-prone string available (more specific
 * than matching on the word `"exclusion"` alone, which could theoretically
 * appear in an unrelated error message).
 */
export function isAppointmentExclusionViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientUnknownRequestError)) {
    return false;
  }
  return error.message.includes(EXCLUSION_CONSTRAINT_NAME);
}
