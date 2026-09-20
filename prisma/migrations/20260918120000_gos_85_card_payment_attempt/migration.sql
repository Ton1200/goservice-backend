-- GOS-85 — Integración base con Mercado Pago + cobro con tarjeta:
-- CardPaymentAttempt (one row per attempt to charge an Engagement to a card)
-- and its status enum. Hand-authored, same category as
-- 20260914120000_gos_87_cash_payment (new enum + new table, no destructive
-- change, no backfill needed) — plus ONE constraint Prisma's schema language
-- cannot express: the partial unique index below.

-- CreateEnum
CREATE TYPE "CardPaymentAttemptStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CardPaymentAttempt" (
    "id" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "status" "CardPaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "providerPaymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardPaymentAttempt_engagementId_idx" ON "CardPaymentAttempt"("engagementId");

-- CreateIndex
CREATE INDEX "CardPaymentAttempt_providerPaymentId_idx" ON "CardPaymentAttempt"("providerPaymentId");

-- AddForeignKey
ALTER TABLE "CardPaymentAttempt" ADD CONSTRAINT "CardPaymentAttempt_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "No double charge" guard, enforced by the database rather than by a
-- read-then-write in application code: an Engagement can have AT MOST ONE
-- attempt that is PENDING (a charge in flight, or awaiting the provider's
-- asynchronous notification) or APPROVED (already paid) at any time. REJECTED
-- attempts are unconstrained — a Customer whose card was declined may try
-- again. A second concurrent insert violates this index (Postgres error
-- 23505, surfaced by Prisma as P2002), which PayEngagementWithCardService
-- turns into CARD_PAYMENT_ALREADY_IN_PROGRESS.
CREATE UNIQUE INDEX "CardPaymentAttempt_engagementId_active_key"
    ON "CardPaymentAttempt"("engagementId")
    WHERE "status" IN ('PENDING', 'APPROVED');
