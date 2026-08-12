-- GOS-30/31/32 Slice 3 — consolidates `FeatureFlag` and `PlatformCredential`
-- into ONE `PlatformSetting` table (Magento `core_config_data`-style: a
-- path + a value, encryption applied per-row via `isEncrypted`, not via a
-- structurally separate model). This is a deliberate, explicit,
-- human-accepted trade-off — see `PlatformSetting`'s own header comment in
-- prisma/schema.prisma for the full reasoning, and the two CHECK
-- constraints below for how this migration makes the accepted risk (a
-- per-row "remember to encrypt" flag) as safe as this architecture allows.
--
-- Data-preserving, not drop-and-reseed: every existing `FeatureFlag`/
-- `PlatformCredential` row is copied forward into `PlatformSetting` BEFORE
-- the old tables are dropped (see the two INSERT ... SELECT statements
-- below). At the time this migration was written, this dev database held 2
-- `FeatureFlag` rows (the seeded `customer.social-login.<provider>.enabled`
-- flags) and 0 `PlatformCredential` rows — but the migration is written to
-- handle a non-empty `PlatformCredential` table correctly regardless of
-- what any given environment actually has.

-- CreateEnum
CREATE TYPE "PlatformSettingValueType" AS ENUM ('BOOLEAN', 'STRING', 'NUMBER');

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "valueType" "PlatformSettingValueType" NOT NULL,
    "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "value" TEXT,
    "ciphertext" BYTEA,
    "iv" BYTEA,
    "authTag" BYTEA,
    "maskedPreview" TEXT,
    "provider" TEXT,
    "updatedByAdminUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSetting_key_key" ON "PlatformSetting"("key");

-- AddForeignKey
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_updatedByAdminUserId_fkey" FOREIGN KEY ("updatedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guardrail #1 (see the consolidation plan's §2 and PlatformSetting's own
-- schema comment): a row physically CANNOT be persisted in a shape where
-- "isEncrypted" disagrees with which columns are populated. An
-- "isEncrypted = true" row MUST have all four encrypted columns populated
-- and "value" NULL; an "isEncrypted = false" row MUST have "value"
-- populated and all four encrypted columns NULL. This makes the exact
-- failure mode the human was warned about (a row whose "isEncrypted" flag
-- was forgotten/wrong while a plaintext "value" sits next to it) impossible
-- to persist at all, not just discouraged by application code remembering
-- correctly. Verified to actually reject bad data — see
-- test/platform-setting-check-constraints.e2e-spec.ts.
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "platform_setting_encrypted_shape_check" CHECK (
  (
    "isEncrypted" = true
    AND "ciphertext" IS NOT NULL
    AND "iv" IS NOT NULL
    AND "authTag" IS NOT NULL
    AND "maskedPreview" IS NOT NULL
    AND "value" IS NULL
  )
  OR
  (
    "isEncrypted" = false
    AND "value" IS NOT NULL
    AND "ciphertext" IS NULL
    AND "iv" IS NULL
    AND "authTag" IS NULL
    AND "maskedPreview" IS NULL
  )
);

-- Guardrail #2: an encrypted row can NEVER also be public — enforced here
-- AND at the service/DTO validation layer AND defensively in the
-- `platformPublicSettings` resolver's own query filter (three independent
-- layers, deliberately redundant — see the consolidation plan's §2).
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "platform_setting_encrypted_not_public_check" CHECK (
  NOT ("isEncrypted" = true AND "isPublic" = true)
);

-- Data migration: FeatureFlag -> PlatformSetting. Every existing flag
-- becomes a non-encrypted, PUBLIC, BOOLEAN setting (matching its previous
-- consumer-facing purpose — see `src/auth/services/social-login.service.ts`
-- and, going forward, `platformPublicSettings`), with its boolean `enabled`
-- column copied into the new `value` TEXT column as the literal string
-- "true"/"false" (the exact shape `SetPlatformSettingService`'s own
-- BOOLEAN-value validation expects — see that service).
INSERT INTO "PlatformSetting" (
  "id", "key", "description", "valueType", "isEncrypted", "isPublic",
  "value", "updatedByAdminUserId", "createdAt", "updatedAt"
)
SELECT
  "id", "key", "description", 'BOOLEAN'::"PlatformSettingValueType", false, true,
  "enabled"::text, "updatedByAdminUserId", "createdAt", "updatedAt"
FROM "FeatureFlag";

-- Data migration: PlatformCredential -> PlatformSetting. Every existing
-- credential becomes an encrypted, non-public, STRING setting — ciphertext/
-- iv/authTag/maskedPreview/provider copied as-is (same AES-256-GCM shape,
-- unchanged), "value" left NULL. `description` did not exist on
-- `PlatformCredential`, so a generic, provider-referencing placeholder is
-- synthesized here; an admin can edit it afterward via `setPlatformSetting`
-- (description is not security-sensitive).
INSERT INTO "PlatformSetting" (
  "id", "key", "description", "valueType", "isEncrypted", "isPublic",
  "ciphertext", "iv", "authTag", "maskedPreview", "provider",
  "updatedByAdminUserId", "createdAt", "updatedAt"
)
SELECT
  "id", "key", 'Migrated credential for ' || "provider" || '.',
  'STRING'::"PlatformSettingValueType", true, false,
  "ciphertext", "iv", "authTag", "maskedPreview", "provider",
  "updatedByAdminUserId", "createdAt", "updatedAt"
FROM "PlatformCredential";

-- DropForeignKey
ALTER TABLE "FeatureFlag" DROP CONSTRAINT "FeatureFlag_updatedByAdminUserId_fkey";

-- DropForeignKey
ALTER TABLE "PlatformCredential" DROP CONSTRAINT "PlatformCredential_updatedByAdminUserId_fkey";

-- DropTable
DROP TABLE "FeatureFlag";

-- DropTable
DROP TABLE "PlatformCredential";
