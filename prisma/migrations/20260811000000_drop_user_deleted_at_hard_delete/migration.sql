-- GOS-3x follow-up (2026-08-11) — REPLACES reversible soft-delete
-- (`User.deletedAt`, migration 20260810234600_add_user_deleted_at_soft_delete)
-- with real hard-delete. Explicit, in-the-moment human authorization for a
-- destructive/irreversible schema change — see ADR 0005's Tenth round for
-- the full rationale (this is a development/testing convenience, not a
-- production data-retention mechanism; a future account-lockout capability
-- will be a separate, new mechanism, not a revival of this column).
--
-- Safe to drop outright: every child table that references "User"
-- (Session, EmailVerificationCode, PasswordResetCode, CustomerProfile,
-- ProfessionalProfile) already declares `onDelete: Cascade` at the Postgres
-- level, so `DELETE FROM "User" WHERE id = ...` already removes all related
-- rows without any FK changes here.

-- DropIndex
DROP INDEX "User_deletedAt_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "deletedAt";
