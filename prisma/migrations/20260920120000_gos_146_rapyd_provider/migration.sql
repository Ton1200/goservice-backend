-- GOS-146 — Rapyd as the second card provider (embedded Checkout Toolkit).
-- Hand-authored, purely additive (Prisma would also generate exactly this).
--
-- 1. "PaymentMethod" gains RAPYD. "A new provider = a new value here": the
--    enum is shared by "Engagement"."paymentMethod" and "PaymentAttempt"."method"
--    (same enum type), so both columns accept it automatically. The value is
--    not used inside this migration, so it is safe within Prisma's migration
--    transaction. The partial unique index on active attempts
--    ("PaymentAttempt_engagementId_active_key") is method-agnostic and already
--    covers Rapyd: still ONE PENDING/APPROVED attempt per Engagement, across
--    providers.
ALTER TYPE "PaymentMethod" ADD VALUE 'RAPYD';

-- 2. Rapyd creates the CHECKOUT before any payment exists, so an attempt needs
--    its own provider-side id besides "providerPaymentId" (Mercado Pago: null).
ALTER TABLE "PaymentAttempt" ADD COLUMN "providerCheckoutId" TEXT;

CREATE INDEX "PaymentAttempt_providerCheckoutId_idx" ON "PaymentAttempt"("providerCheckoutId");
