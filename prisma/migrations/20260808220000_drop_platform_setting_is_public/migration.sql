-- GOS-3x follow-up — removes `PlatformSetting.isPublic` entirely, per
-- explicit human decision after discussion: a manual per-row "is this
-- public" flag is unnecessary complexity on top of `isEncrypted`. Whether a
-- `PlatformSetting` is encrypted is now the ONLY gate that matters — a
-- non-encrypted (i.e. not secret) value is inherently safe to expose to
-- `goservice-mobile` via `platformPublicSettings`, no separate manual flag
-- required. See `PlatformSetting`'s own header comment in
-- prisma/schema.prisma for the full reasoning.
--
-- Drops `platform_setting_encrypted_not_public_check` first — it existed
-- ONLY to guard the `isEncrypted && isPublic` combination, which no longer
-- has any meaning once `isPublic` itself is gone. Does NOT touch
-- `platform_setting_encrypted_shape_check` (added by the same prior
-- migration, `20260808210000_consolidate_platform_settings`) — that
-- constraint guards the encrypted-vs-plain COLUMN SHAPE (ciphertext/iv/
-- authTag/maskedPreview vs. value), which is entirely unrelated to
-- `isPublic` and remains fully relevant.
--
-- No data-loss concern worth a data migration step here: `isPublic` was a
-- boolean with no independent meaning once `isEncrypted` is known (every
-- `isEncrypted: false` row becomes automatically public going forward,
-- which was already true for every existing non-encrypted row in this dev
-- database — the two seeded `customer.social-login.<provider>.enabled`
-- flags were both `isPublic: true`).

-- DropCheckConstraint
ALTER TABLE "PlatformSetting" DROP CONSTRAINT "platform_setting_encrypted_not_public_check";

-- AlterTable
ALTER TABLE "PlatformSetting" DROP COLUMN "isPublic";
