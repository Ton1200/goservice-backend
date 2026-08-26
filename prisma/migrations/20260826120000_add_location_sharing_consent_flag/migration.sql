-- GOS-62 — purely additive consent flag, same "hand-authored but simple"
-- category as prisma/migrations/20260805000916_add_profile_photo_and_professional_extra_fields
-- (plain `ADD COLUMN ... DEFAULT`, no type change, no data cast). Every
-- existing CustomerProfile/ProfessionalProfile row gets `false` for this new
-- column (Postgres backfills NOT NULL DEFAULT columns in-place) — the
-- correct default per DEC-005 (opt-in, never opt-out-by-default). This
-- migration adds ONLY a boolean consent flag: no latitude/longitude column,
-- no geospatial index, no proximity logic — that belongs to a separate
-- future story once DEC-005 (still status "Proposed") is actually decided.

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "locationSharingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "locationSharingEnabled" BOOLEAN NOT NULL DEFAULT false;
