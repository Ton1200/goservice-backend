-- GOS-146 follow-up — regroup the `payments.*` PlatformSetting keys BY PAYMENT METHOD.
--
-- Why: the admin panel builds its tree from the dot-path of each key, and the
-- payment settings were scattered — "Mercadopago" and "Rapyd" appeared as loose
-- blocks above, "Mercadopago" a second time as a group (per-country credentials,
-- wallet back-urls), and the enable switches + display names of the methods in a
-- separate "Payment Methods" group. Now everything that belongs to a method lives
-- under `payments.payment-methods.<provider or method>`:
--
--   payments.general-settings.commission.percent            (unchanged)
--   payments.general-settings.callbacks.public-base-url     (was payments.mercadopago.public-base-url — the
--                                                            backend's own public origin, used by Mercado Pago's
--                                                            wallet AND Rapyd's webhook, so not Mercado Pago's)
--   payments.payment-methods.cash.*                         (unchanged)
--   payments.payment-methods.mercadopago.card.*             (was payments.payment-methods.card.*)
--   payments.payment-methods.mercadopago.wallet.*           (was payments.payment-methods.mercadopago-wallet.* AND
--                                                            payments.mercadopago.wallet.back-url-*)
--   payments.payment-methods.mercadopago.<ar|co>.*          (was payments.mercadopago.<ar|co>.*)
--   payments.payment-methods.rapyd.*                        (was payments.rapyd.* — credentials, environment, expiry —
--                                                            merged with the existing enabled/display-name)
--   payments.payment-methods.rapyd.saved-cards-enabled      (was payments.payment-methods.rapyd.saved-cards.enabled;
--                                                            flat, so it renders in the SAME block as the rest of Rapyd)
--
-- Data-only: only the `key` column changes. Values, the ENCRYPTED credentials
-- (ciphertext/iv/authTag — the encryption is not bound to the key name), the
-- `isPublic` flags and the audit columns are untouched. Idempotent and safe on a
-- database that never had some of these rows: a row is renamed only if its new key
-- is free (a fresh database seeded with the new keys is left alone).
WITH mapping (old_key, new_key) AS (
  VALUES
    ('payments.mercadopago.public-base-url', 'payments.general-settings.callbacks.public-base-url'),
    ('payments.payment-methods.card.enabled', 'payments.payment-methods.mercadopago.card.enabled'),
    ('payments.payment-methods.card.display-name', 'payments.payment-methods.mercadopago.card.display-name'),
    ('payments.payment-methods.mercadopago-wallet.enabled', 'payments.payment-methods.mercadopago.wallet.enabled'),
    ('payments.payment-methods.mercadopago-wallet.display-name', 'payments.payment-methods.mercadopago.wallet.display-name'),
    ('payments.rapyd.environment', 'payments.payment-methods.rapyd.environment'),
    ('payments.rapyd.access-key', 'payments.payment-methods.rapyd.access-key'),
    ('payments.rapyd.secret-key', 'payments.payment-methods.rapyd.secret-key'),
    ('payments.rapyd.checkout-expiration-minutes', 'payments.payment-methods.rapyd.checkout-expiration-minutes'),
    ('payments.payment-methods.rapyd.saved-cards.enabled', 'payments.payment-methods.rapyd.saved-cards-enabled')
  UNION ALL
  -- Every other `payments.mercadopago.*` key: per-country credentials (`<ar|co>.*`) and the wallet back-urls.
  SELECT "key", 'payments.payment-methods.mercadopago.' || substr("key", length('payments.mercadopago.') + 1)
  FROM "PlatformSetting"
  WHERE "key" LIKE 'payments.mercadopago.%'
    AND "key" <> 'payments.mercadopago.public-base-url'
)
UPDATE "PlatformSetting" AS setting
SET "key" = mapping.new_key
FROM mapping
WHERE setting."key" = mapping.old_key
  AND NOT EXISTS (
    SELECT 1 FROM "PlatformSetting" AS existing WHERE existing."key" = mapping.new_key
  );
