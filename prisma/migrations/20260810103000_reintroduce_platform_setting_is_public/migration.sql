-- GOS-3x follow-up #2 (2026-08-10) — REINTRODUCES `PlatformSetting.isPublic`,
-- previously removed by `20260808220000_drop_platform_setting_is_public`.
-- Human-approved, explicit reversal — not an oversight or a re-application
-- of the same migration: at removal time only 2 settings existed and both
-- happened to want the same outcome ("not encrypted" == "safe to expose to
-- mobile"), so a separate manual flag looked like unnecessary complexity.
-- That equivalence stops holding once more credential-shaped
-- (`isEncrypted: true`) settings — and, more importantly, non-secret
-- settings that are NOT meant to be mobile-facing (backend/admin-only
-- config that still isn't a secret) — become real, not hypothetical. See
-- `PlatformSetting`'s own header comment in prisma/schema.prisma, and
-- ADR 0005's dedicated section on this reversal, for the full reasoning.
--
-- Semantics (two INDEPENDENT axes, neither inferred from the other):
--   isEncrypted -> "is this value a secret?"                 (unchanged)
--   isPublic    -> "should this be exposed via the
--                   unauthenticated `platformConfig` query?"  (NEW, again)
-- A brand-new setting is backend/admin-only by DEFAULT (`isPublic` defaults
-- to `false`) even when it isn't a secret — an explicit opt-in is now
-- required, reversing the previous "every non-encrypted row is
-- automatically public" behavior.
--
-- `isEncrypted: true` is a HARD VETO over `isPublic` — a row can never be
-- both encrypted AND public at the same time. Enforced structurally here
-- (`platform_setting_encrypted_not_public_check`, mirroring the exact same
-- constraint name/shape this migration's own reverted predecessor
-- originally introduced in `20260808210000_consolidate_platform_settings`)
-- AND at the application/DTO validation layer (`SetPlatformSettingService`,
-- rejecting with a clear `DomainException` BEFORE hitting the DB) as the
-- first line of defense — the DB constraint remains the real,
-- unbypassable backstop. Does NOT touch
-- `platform_setting_encrypted_shape_check` (added by the same prior
-- migration) — that constraint guards the encrypted-vs-plain COLUMN SHAPE
-- (ciphertext/iv/authTag/maskedPreview vs. value), entirely unrelated to
-- `isPublic`.

-- AddColumn
ALTER TABLE "PlatformSetting" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- AddCheckConstraint
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "platform_setting_encrypted_not_public_check" CHECK (
  NOT ("isEncrypted" = true AND "isPublic" = true)
);

-- Data fixup — CRITICAL, must-not-break: `goservice-mobile`'s
-- WelcomeScreen/LoginScreen already read `platformConfig` TODAY to decide
-- whether to show Google/Apple sign-in buttons. Before this migration, that
-- worked automatically (every `isEncrypted: false` row was public with no
-- separate flag). After this migration, `isPublic` is a separate,
-- default-OFF gate — without this step, `platformConfig` would silently
-- start returning an empty tree for these keys on every existing
-- environment, and mobile's social-login buttons would silently disappear.
-- Explicitly opts in exactly the 4 known keys these reference cases depend
-- on (both providers' `enabled` AND `client-id` keys, even though only
-- Google's `client-id` row exists in most environments today) — safe/inert
-- via the `WHERE key IN (...)` predicate if a given row doesn't exist in a
-- given environment.
UPDATE "PlatformSetting"
SET "isPublic" = true
WHERE "key" IN (
  'customer.social-login.google.enabled',
  'customer.social-login.apple.enabled',
  'customer.social-login.google.client-id',
  'customer.social-login.apple.client-id'
);
