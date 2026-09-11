-- GOS-117 — two independent additions to the same story (GOS-104):
-- 1) Professional-initiated cancellation reuses the EXISTING
--    Engagement.status/cancelledAt/cancelReason columns (GOS-114) and the
--    EXISTING role-agnostic cancelIfActive CAS — no new Engagement column
--    needed, no cancelledByRole.
-- 2) No-show reporting is a pure trust/reliability counter with ZERO
--    effect on Engagement.status — one new column on EACH of
--    CustomerProfile and ProfessionalProfile, incremented on the OTHER
--    party's profile whenever one side reports a no-show. Not
--    deduplicated, not exposed via GraphQL yet.

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "noShowReportedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "noShowReportedCount" INTEGER NOT NULL DEFAULT 0;
