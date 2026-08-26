-- CreateEnum
CREATE TYPE "AppointmentParty" AS ENUM ('CUSTOMER', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "proposedByRole" "AppointmentParty" NOT NULL,
    "proposedByCustomerProfileId" UUID,
    "proposedByProfessionalProfileId" UUID,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_engagementId_createdAt_idx" ON "Appointment"("engagementId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_professionalProfileId_status_idx" ON "Appointment"("professionalProfileId", "status");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_proposedByCustomerProfileId_fkey" FOREIGN KEY ("proposedByCustomerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_proposedByProfessionalProfileId_fkey" FOREIGN KEY ("proposedByProfessionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Needed for the EXCLUDE constraint below: professionalProfileId is a uuid
-- column, GiST needs btree_gist's equality operator class to index equality
-- on a non-range type inside an EXCLUDE constraint. Ships in Postgres's own
-- contrib package (postgres:18 image already includes it).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Structural guardrail, same precedent as quote_negotiation_message_author_shape_check
-- / engagement_chat_message_sender_shape_check.
ALTER TABLE "Appointment" ADD CONSTRAINT "appointment_proposed_by_shape_check" CHECK (
  ("proposedByRole" = 'CUSTOMER' AND "proposedByCustomerProfileId" IS NOT NULL AND "proposedByProfessionalProfileId" IS NULL)
  OR ("proposedByRole" = 'PROFESSIONAL' AND "proposedByProfessionalProfileId" IS NOT NULL AND "proposedByCustomerProfileId" IS NULL)
);

-- Defense-in-depth alongside the service-level check; a zero/negative
-- duration would corrupt tstzrange overlap semantics.
ALTER TABLE "Appointment" ADD CONSTRAINT "appointment_time_range_check" CHECK ("endsAt" > "startsAt");

-- THE real DB-level guarantee — scoped to CONFIRMED only, by design (two
-- PENDING proposals for the same professional may overlap; only a
-- CONFIRMED slot is a real commitment). Violation raises Postgres
-- SQLSTATE 23P01 (exclusion_violation), caught and translated to
-- APPOINTMENT_CONFLICT in AppointmentsRepository.confirmIfPending.
--
-- CONFIRMED DEVIATION from the plan's literal SQL (empirically discovered,
-- not guessed — `npx prisma migrate dev --create-only` for Migration B
-- failed with "functions in index expression must be marked IMMUTABLE"):
-- the plan's own SQL used `tstzrange(...)`, but `startsAt`/`endsAt` are
-- Prisma `DateTime` columns with no `@db.Timestamptz` annotation, so they
-- are `TIMESTAMP(3)` (no time zone) at the Postgres level — the SAME plain
-- "timestamp without time zone" every other `DateTime` column in this whole
-- schema already uses (no exceptions). `tstzrange(timestamp, timestamp)`
-- implicitly casts each argument via `timestamptz(timestamp)`, which is
-- STABLE (depends on the session's `TimeZone` setting), never IMMUTABLE —
-- Postgres refuses to build a GiST index expression around it. `tsrange`
-- operates directly on `timestamp without time zone` with no cast at all,
-- is genuinely IMMUTABLE, and is also the semantically correct range type
-- here: this whole application already stores/compares every timestamp as a
-- naive value (no per-row time zone), so there is no cross-time-zone
-- semantic this constraint needs `tstzrange` for.
ALTER TABLE "Appointment" ADD CONSTRAINT "appointment_no_overlapping_confirmed_per_professional" EXCLUDE USING gist (
  "professionalProfileId" WITH =,
  tsrange("startsAt", "endsAt") WITH &&
) WHERE ("status" = 'CONFIRMED');
