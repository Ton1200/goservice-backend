-- GOS-62b (2026-09-08) — DESTRUCTIVE, intentional. Explicit, in-the-moment
-- human authorization for an irreversible schema change (same posture as
-- migration 20260811000000_drop_user_deleted_at_hard_delete). No data is
-- retained: `addressLine`/`city`/`province` (CustomerProfile) and
-- `city`/`serviceAreaDescription` (ProfessionalProfile) were GOS-14/GOS-28
-- free-text placeholders for a future location-aware Discovery, held only
-- test/demo data, and are removed here in full — columns and their composite
-- `@@index([country, city])` indexes.
--
-- `country` is deliberately kept on both tables and is re-indexed on its own
-- (`@@index([country])`) — Identity Verification resolves the KYC provider
-- by country (`ProfilesRepository.findCountryForUser`).
--
-- Structured address will return later as its own geocoded entity — see
-- DEC-005 (Location & Proximity, still status "Proposed"). It is NOT
-- reintroduced by this migration.

-- DropIndex
DROP INDEX "CustomerProfile_country_city_idx";

-- DropIndex
DROP INDEX "ProfessionalProfile_country_city_idx";

-- AlterTable
ALTER TABLE "CustomerProfile" DROP COLUMN "addressLine",
DROP COLUMN "city",
DROP COLUMN "province";

-- AlterTable
ALTER TABLE "ProfessionalProfile" DROP COLUMN "city",
DROP COLUMN "serviceAreaDescription";

-- CreateIndex
CREATE INDEX "CustomerProfile_country_idx" ON "CustomerProfile"("country");

-- CreateIndex
CREATE INDEX "ProfessionalProfile_country_idx" ON "ProfessionalProfile"("country");
