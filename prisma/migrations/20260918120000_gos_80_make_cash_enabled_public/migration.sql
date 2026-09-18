-- GOS-80 follow-up (2026-09-18) — data-only fixup, no schema change.
-- `goservice-mobile` must show/hide the Cash payment option from
-- `platformConfig` (`payments.paymentMethods.cash.enabled`), which only
-- returns rows with `isPublic = true`. `prisma/seed.ts` now seeds this row
-- `isPublic: true`, but its upsert uses `update: {}` (never clobbers an
-- admin-edited row), so environments where the row already exists as
-- `isPublic = false` would never pick the change up. This flips ONLY that
-- one key — `value` (an admin's on/off choice) is untouched, and every other
-- `payments.*` setting (e.g. `payments.general-settings.commission.percent`)
-- stays private. Inert (matches zero rows) where the row doesn't exist yet;
-- a fresh install gets `isPublic: true` straight from the seed.
UPDATE "PlatformSetting"
SET "isPublic" = true
WHERE "key" = 'payments.payment-methods.cash.enabled'
  AND "isEncrypted" = false;
