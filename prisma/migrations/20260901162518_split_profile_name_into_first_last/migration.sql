-- Hand-written after `prisma migrate dev --create-only` refused to run
-- non-interactively (it flagged the new required `firstName`/`lastName`
-- columns as unsafe against existing rows, and the `displayName` drop as
-- data-loss). Same "hand-edit a data-preserving migration" pattern as
-- `20260814010316_identity_verification_and_country_enum/migration.sql`.
--
-- WHAT THIS DOES: splits the single free-text person-name column on both
-- profile tables into two columns — `displayName` -> `firstName` +
-- `lastName` (nombre / apellido). `CustomerProfile.displayName` is dropped
-- entirely. `ProfessionalProfile.displayName` SURVIVES but becomes
-- nullable, resignified as an optional public "nombre comercial" (e.g.
-- "Diego Torres - Limpieza y Electricidad"), distinct from the person's
-- real name — see prisma/schema.prisma's own comments on both models.
--
-- BACKFILL: demo/seed data only in every environment this migration will
-- ever run against (the dev DB had 6 rows per table, all seed personas;
-- the e2e DB is wiped per run). The backfill is a deliberately naive
-- split-on-first-space: `firstName` = first token, `lastName` = the rest.
-- It is lossy for single-token names (`lastName` falls back to '-') and
-- for names with 3+ tokens (`lastName` keeps the remainder). `left(...,80)`
-- clamps every backfilled value to the new `@MaxLength(80)` DTO bound so
-- the `SET NOT NULL` below can never fail on a legacy 120-char value.
-- `seed-demo-data.ts` is rewritten in the same change to emit real
-- first/last values, so these backfilled rows are transient anyway.
--
-- Neither table's `@@index([country, city])` involves these columns, so no
-- index is dropped or recreated here.

-- ---------------------------------------------------------------------------
-- CustomerProfile: displayName -> firstName + lastName
-- ---------------------------------------------------------------------------
ALTER TABLE "CustomerProfile" ADD COLUMN "firstName" TEXT;
ALTER TABLE "CustomerProfile" ADD COLUMN "lastName"  TEXT;

UPDATE "CustomerProfile" SET
  "firstName" = left(NULLIF(btrim(split_part(btrim("displayName"), ' ', 1)), ''), 80),
  "lastName"  = left(
    CASE
      WHEN strpos(btrim("displayName"), ' ') > 0
      THEN btrim(substr(btrim("displayName"), strpos(btrim("displayName"), ' ') + 1))
      ELSE NULL
    END, 80);

UPDATE "CustomerProfile" SET "firstName" = '-' WHERE "firstName" IS NULL OR "firstName" = '';
UPDATE "CustomerProfile" SET "lastName"  = '-' WHERE "lastName"  IS NULL OR "lastName"  = '';

ALTER TABLE "CustomerProfile" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "CustomerProfile" ALTER COLUMN "lastName"  SET NOT NULL;
ALTER TABLE "CustomerProfile" DROP COLUMN "displayName";

-- ---------------------------------------------------------------------------
-- ProfessionalProfile: add firstName + lastName; keep displayName, nullable
-- ---------------------------------------------------------------------------
ALTER TABLE "ProfessionalProfile" ADD COLUMN "firstName" TEXT;
ALTER TABLE "ProfessionalProfile" ADD COLUMN "lastName"  TEXT;

UPDATE "ProfessionalProfile" SET
  "firstName" = left(NULLIF(btrim(split_part(btrim("displayName"), ' ', 1)), ''), 80),
  "lastName"  = left(
    CASE
      WHEN strpos(btrim("displayName"), ' ') > 0
      THEN btrim(substr(btrim("displayName"), strpos(btrim("displayName"), ' ') + 1))
      ELSE NULL
    END, 80);

UPDATE "ProfessionalProfile" SET "firstName" = '-' WHERE "firstName" IS NULL OR "firstName" = '';
UPDATE "ProfessionalProfile" SET "lastName"  = '-' WHERE "lastName"  IS NULL OR "lastName"  = '';

ALTER TABLE "ProfessionalProfile" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "ProfessionalProfile" ALTER COLUMN "lastName"  SET NOT NULL;

-- displayName survives as the optional "nombre comercial"
ALTER TABLE "ProfessionalProfile" ALTER COLUMN "displayName" DROP NOT NULL;
