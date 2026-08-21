-- Hand-edited after `prisma migrate dev --create-only` (Prisma cannot
-- generate a safe String -> enum column-type change on its own — see
-- prisma/schema.prisma's own comment on CustomerProfile.country/
-- ProfessionalProfile.country, and the Identity Verification implementation
-- plan's section 15, step 2). Prisma's own draft for this migration used
-- `DROP COLUMN "country", ADD COLUMN "country" "CountryCode" ...`, which
-- would have silently discarded every existing row's country value. This
-- hand-written version instead does an in-place `ALTER COLUMN ... TYPE
-- "CountryCode" USING country::"CountryCode"` cast, preserving existing
-- data. Verified safe for this environment before editing: both
-- `CustomerProfile` and `ProfessionalProfile` had ZERO rows in the local
-- dev database at the time this migration was written (checked via
-- `SELECT DISTINCT country FROM ...` — both returned 0 rows), so there is
-- no legacy value outside {'AR'} to worry about here; the explicit `USING`
-- cast is still the correct, safe pattern for ANY environment (including
-- ones that do have data), not just this one. A text value that is not a
-- valid `CountryCode` label would make this cast fail loudly at migration
-- time (the correct behavior — never silently coerce/drop unexpected data),
-- not corrupt or truncate anything.
--
-- Because this uses `ALTER COLUMN ... TYPE` (not `DROP COLUMN` +
-- `ADD COLUMN`), the pre-existing `CustomerProfile_country_city_idx` /
-- `ProfessionalProfile_country_city_idx` indexes (created by an earlier
-- migration) are NOT dropped and do not need to be recreated — Prisma's
-- draft included `CREATE INDEX` statements for both, which have been
-- removed here as redundant/would-error-on-already-exists.

-- CreateEnum
CREATE TYPE "CountryCode" AS ENUM ('AR', 'CO');

-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'FOREIGN_ID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: CustomerProfile.country String -> CountryCode, data-preserving cast.
ALTER TABLE "CustomerProfile"
  ALTER COLUMN "country" DROP DEFAULT,
  ALTER COLUMN "country" TYPE "CountryCode" USING ("country"::"CountryCode"),
  ALTER COLUMN "country" SET DEFAULT 'AR';

-- AlterTable: ProfessionalProfile.country String -> CountryCode, data-preserving cast.
ALTER TABLE "ProfessionalProfile"
  ALTER COLUMN "country" DROP DEFAULT,
  ALTER COLUMN "country" TYPE "CountryCode" USING ("country"::"CountryCode"),
  ALTER COLUMN "country" SET DEFAULT 'AR';

-- CreateTable
CREATE TABLE "IdentityVerification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "country" "CountryCode" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'didit',
    "providerReference" TEXT,
    "documentType" "IdentityDocumentType" NOT NULL DEFAULT 'UNKNOWN',
    "documentCheckPassed" BOOLEAN,
    "biometricCheckPassed" BOOLEAN,
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdentityVerification_userId_idx" ON "IdentityVerification"("userId");

-- CreateIndex
CREATE INDEX "IdentityVerification_provider_providerReference_idx" ON "IdentityVerification"("provider", "providerReference");

-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
