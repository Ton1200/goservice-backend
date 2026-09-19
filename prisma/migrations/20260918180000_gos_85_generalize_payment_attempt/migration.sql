-- GOS-85 — generalize CardPaymentAttempt -> PaymentAttempt and record the
-- non-sensitive facts of HOW a payment was made. Hand-authored (Prisma would
-- generate a destructive drop+create for a rename): every statement below is a
-- RENAME or an additive column, so existing rows and the "no double charge"
-- partial unique index are preserved as-is.
--
-- Why: 2026-09-18 product decision — Mercado Pago has no reusable card token
-- (so "save a card" does not apply), and a user paying with their OWN Mercado
-- Pago account (balance / saved cards) is a wallet payment, not a card
-- payment; the entity therefore cannot carry a card-shaped name.

-- Rename the enum, the table and every object Prisma named after it.
ALTER TYPE "CardPaymentAttemptStatus" RENAME TO "PaymentAttemptStatus";
ALTER TABLE "CardPaymentAttempt" RENAME TO "PaymentAttempt";
ALTER TABLE "PaymentAttempt" RENAME CONSTRAINT "CardPaymentAttempt_pkey" TO "PaymentAttempt_pkey";
ALTER TABLE "PaymentAttempt" RENAME CONSTRAINT "CardPaymentAttempt_engagementId_fkey" TO "PaymentAttempt_engagementId_fkey";
ALTER INDEX "CardPaymentAttempt_engagementId_idx" RENAME TO "PaymentAttempt_engagementId_idx";
ALTER INDEX "CardPaymentAttempt_providerPaymentId_idx" RENAME TO "PaymentAttempt_providerPaymentId_idx";
-- The partial unique index that enforces "at most one PENDING/APPROVED attempt
-- per Engagement" (see 20260918120000_gos_85_card_payment_attempt).
ALTER INDEX "CardPaymentAttempt_engagementId_active_key" RENAME TO "PaymentAttempt_engagementId_active_key";

-- CreateEnum: HOW the Customer pays. MERCADOPAGO_WALLET is reserved for the
-- follow-up wallet story (no writer yet).
CREATE TYPE "PaymentAttemptMethod" AS ENUM ('CARD', 'MERCADOPAGO_WALLET');

-- Every existing row is a card attempt, hence the DEFAULT.
ALTER TABLE "PaymentAttempt" ADD COLUMN "method" "PaymentAttemptMethod" NOT NULL DEFAULT 'CARD';

-- Non-sensitive facts about how it was paid, all nullable / best-effort.
-- NEVER the card number, CVV, token, cardholder name/document or payer phone.
ALTER TABLE "PaymentAttempt"
    ADD COLUMN "paymentTypeId" TEXT,
    ADD COLUMN "cardBrand" TEXT,
    ADD COLUMN "cardLastFour" TEXT,
    ADD COLUMN "providerFeeAmount" INTEGER,
    ADD COLUMN "providerTaxAmount" INTEGER,
    ADD COLUMN "netReceivedAmount" INTEGER,
    ADD COLUMN "providerApprovedAt" TIMESTAMP(3),
    ADD COLUMN "moneyReleaseAt" TIMESTAMP(3);
