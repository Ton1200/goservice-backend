-- GOS-85 — every payment, whatever its method, lives in "PaymentAttempt".
-- Hand-authored (Prisma would generate a destructive drop+create for the enum
-- swap and cannot express the data copy below).
--
-- Why: 2026-09-18 product decision. Cash was its own table
-- ("CashPaymentConfirmation") with its own "commission debt recorded" flag;
-- digital payments were "PaymentAttempt". One table means one lifecycle
-- (PENDING -> APPROVED), one idempotency mechanism (the guarded status CAS),
-- and one database-level guarantee that an Engagement cannot be paid twice or
-- by two methods at once (the partial unique index on active attempts).
--
-- Only test data exists in the databases this runs on. The cash rows are
-- copied, not dropped blind; an Engagement that ALSO has an active digital
-- attempt would violate the partial unique index and make this migration fail
-- loudly, on purpose, rather than silently lose a payment record.

-- 1. "PaymentMethod": CARD -> MERCADOPAGO. The method names the collector, not
--    the instrument (a Mercado Pago account-money payment is not a card).
--    ("Engagement"."paymentMethod" follows automatically: same enum type.)
ALTER TYPE "PaymentMethod" RENAME VALUE 'CARD' TO 'MERCADOPAGO';

-- 2. "PaymentAttempt"."method" now uses that same enum instead of its own.
--    Every existing row was a Mercado Pago attempt (card or the reserved wallet).
ALTER TABLE "PaymentAttempt" ALTER COLUMN "method" DROP DEFAULT;
ALTER TABLE "PaymentAttempt"
    ALTER COLUMN "method" TYPE "PaymentMethod" USING ('MERCADOPAGO'::text)::"PaymentMethod";
DROP TYPE "PaymentAttemptMethod";

-- 3. HOW it was paid inside a method (Mercado Pago's own payment_type_id
--    standard, plus CASH), and the two cash confirmations.
CREATE TYPE "PaymentAttemptType" AS ENUM ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'ACCOUNT_MONEY');
ALTER TABLE "PaymentAttempt"
    ADD COLUMN "type" "PaymentAttemptType",
    ADD COLUMN "customerConfirmedAt" TIMESTAMP(3),
    ADD COLUMN "professionalConfirmedAt" TIMESTAMP(3);

-- Existing Mercado Pago rows: the type is known once a payment record was read;
-- rows still PENDING/REJECTED without one stay NULL (unknown).
UPDATE "PaymentAttempt"
SET "type" = CASE "paymentTypeId"
    WHEN 'credit_card' THEN 'CREDIT_CARD'
    WHEN 'debit_card' THEN 'DEBIT_CARD'
    WHEN 'account_money' THEN 'ACCOUNT_MONEY'
END::"PaymentAttemptType"
WHERE "paymentTypeId" IN ('credit_card', 'debit_card', 'account_money');

-- 4. Copy every cash confirmation into "PaymentAttempt".
--    status: both parties confirmed (the commission debt was recorded) -> APPROVED,
--    otherwise PENDING. amount/currency are the same values the confirmation
--    service derives at write time: the accepted quote's negotiatedPrice ?? price,
--    and the currency of the Customer's country (AR -> ARS, CO -> COP).
INSERT INTO "PaymentAttempt" (
    "id", "engagementId", "method", "type", "status",
    "amount", "currency", "installments",
    "customerConfirmedAt", "professionalConfirmedAt",
    "createdAt", "updatedAt"
)
SELECT
    c."id", c."engagementId", 'CASH'::"PaymentMethod", 'CASH'::"PaymentAttemptType",
    CASE WHEN c."commissionDebtRecorded" THEN 'APPROVED' ELSE 'PENDING' END::"PaymentAttemptStatus",
    COALESCE(q."negotiatedPrice", q."price"),
    CASE cp."country" WHEN 'AR' THEN 'ARS' WHEN 'CO' THEN 'COP' END,
    1,
    c."customerConfirmedAt", c."professionalConfirmedAt",
    c."createdAt", c."createdAt"
FROM "CashPaymentConfirmation" c
JOIN "Engagement" e ON e."id" = c."engagementId"
JOIN "Quote" q ON q."id" = e."quoteId"
JOIN "CustomerProfile" cp ON cp."id" = e."customerProfileId";

-- 5. The old table is now fully represented in "PaymentAttempt".
DROP TABLE "CashPaymentConfirmation";
