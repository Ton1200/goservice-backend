-- GOS-114 — Customer-initiated cancellation of an open Engagement
-- (ACCEPTED|IN_PROGRESS -> CANCELLED). CANCELLED itself already exists in
-- EngagementStatus (added by GOS-111, still unused until now). This
-- migration only adds the two timestamp/reason columns, same nullable,
-- no-@default criterion as Appointment.cancelReason/cancelledAt and as
-- this Engagement model's own startedAt/finishedAt (GOS-111).

-- AlterTable
ALTER TABLE "Engagement" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT;
