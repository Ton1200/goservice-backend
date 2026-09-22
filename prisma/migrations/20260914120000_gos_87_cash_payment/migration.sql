-- GOS-87 — Pago en Efectivo: PaymentMethod (CASH real, CARD reserved),
-- Engagement.paymentMethod (the single point of truth for which method a
-- job is/was using), CashPaymentConfirmation (double confirmation before a
-- CASH_COMMISSION_DEBT LedgerEntry is written), and the new
-- CASH_PAYMENTS_READ admin permission. Hand-authored, same category as
-- 20260912202059_add_ledger_entry (new enum + new table + new permission
-- value, no destructive change, no backfill needed).

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD');

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'CASH_PAYMENTS_READ';

-- AlterTable
ALTER TABLE "Engagement" ADD COLUMN     "paymentMethod" "PaymentMethod";

-- CreateTable
CREATE TABLE "CashPaymentConfirmation" (
    "id" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "customerConfirmedAt" TIMESTAMP(3),
    "professionalConfirmedAt" TIMESTAMP(3),
    "commissionDebtRecorded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashPaymentConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashPaymentConfirmation_engagementId_key" ON "CashPaymentConfirmation"("engagementId");

-- AddForeignKey
ALTER TABLE "CashPaymentConfirmation" ADD CONSTRAINT "CashPaymentConfirmation_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
