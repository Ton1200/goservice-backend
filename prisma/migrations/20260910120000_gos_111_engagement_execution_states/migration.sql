-- GOS-111 — extend EngagementStatus to the full work-execution state machine
-- (ACCEPTED -> IN_PROGRESS -> PENDING_CUSTOMER_CONFIRMATION; COMPLETED/CANCELLED
-- reserved for GOS-113/114/117, no transition into either yet) and add the
-- startedAt/finishedAt timestamps, same nullable-DateTime criterion as
-- Appointment.confirmedAt/cancelledAt. Hand-authored (hand-rounded timestamp),
-- same category as 20260826120000_add_location_sharing_consent_flag.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EngagementStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "EngagementStatus" ADD VALUE 'PENDING_CUSTOMER_CONFIRMATION';
ALTER TYPE "EngagementStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "EngagementStatus" ADD VALUE 'CANCELLED';

-- AlterTable
-- Every existing Engagement row keeps status = 'ACCEPTED' (the column is already
-- NOT NULL DEFAULT 'ACCEPTED' and that default is unchanged) and gets
-- startedAt/finishedAt = NULL. No data backfill / UPDATE is needed or done — no
-- data loss. ADD COLUMN does not touch existing rows' updatedAt (Prisma's
-- @updatedAt is client-side, there is no DB trigger).
ALTER TABLE "Engagement" ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "finishedAt" TIMESTAMP(3);
