-- GOS-146 — Rapyd: ONE credential set for every country.
-- Hand-authored data migration (no schema change).
--
-- Why: verified live on 2026-09-21 that the SAME Rapyd access/secret key
-- created and completed a Colombia/COP payment AND an Argentina/ARS payment (a
-- Rapyd account is multi-country, unlike a Mercado Pago one). So the settings
-- `payments.rapyd.<country>.{access-key,secret-key,environment}` collapse to
-- the global `payments.rapyd.{access-key,secret-key,environment}`.
--
-- Rows are RENAMED in place (never decrypted/re-encrypted: the AES-GCM
-- ciphertext does not depend on the key name), so an admin who already loaded a
-- pair does not have to load it again. Colombia's pair wins, else Argentina's;
-- a pair is only promoted whole (both keys of the SAME country). The old
-- per-country rows are then removed. Idempotent, and a no-op on an environment
-- that never had the per-country rows (the seed creates the global environment).

DO $$
DECLARE
  src text;
BEGIN
  FOREACH src IN ARRAY ARRAY['co', 'ar'] LOOP
    IF NOT EXISTS (SELECT 1 FROM "PlatformSetting" WHERE "key" = 'payments.rapyd.access-key')
       AND NOT EXISTS (SELECT 1 FROM "PlatformSetting" WHERE "key" = 'payments.rapyd.secret-key')
       AND EXISTS (SELECT 1 FROM "PlatformSetting" WHERE "key" = 'payments.rapyd.' || src || '.access-key')
       AND EXISTS (SELECT 1 FROM "PlatformSetting" WHERE "key" = 'payments.rapyd.' || src || '.secret-key') THEN
      UPDATE "PlatformSetting" SET "key" = 'payments.rapyd.access-key'
        WHERE "key" = 'payments.rapyd.' || src || '.access-key';
      UPDATE "PlatformSetting" SET "key" = 'payments.rapyd.secret-key'
        WHERE "key" = 'payments.rapyd.' || src || '.secret-key';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM "PlatformSetting" WHERE "key" = 'payments.rapyd.environment')
       AND EXISTS (SELECT 1 FROM "PlatformSetting" WHERE "key" = 'payments.rapyd.' || src || '.environment') THEN
      UPDATE "PlatformSetting" SET "key" = 'payments.rapyd.environment'
        WHERE "key" = 'payments.rapyd.' || src || '.environment';
    END IF;
  END LOOP;
END $$;

DELETE FROM "PlatformSetting" WHERE "key" ~ '^payments\.rapyd\.(co|ar)\.';
