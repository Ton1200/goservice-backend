-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CUSTOMER_CHARGE', 'PLATFORM_COMMISSION', 'PROFESSIONAL_NET_CREDIT', 'CASH_COMMISSION_DEBT', 'CUSTOMER_CANCELLATION_FEE', 'REFUND', 'WITHDRAWAL', 'WITHDRAWAL_HOLD_RELEASE');

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'LEDGER_READ';

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "engagementId" UUID,
    "customerProfileId" UUID,
    "professionalProfileId" UUID,
    "commissionPercentApplied" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerEntry_engagementId_idx" ON "LedgerEntry"("engagementId");

-- CreateIndex
CREATE INDEX "LedgerEntry_professionalProfileId_createdAt_idx" ON "LedgerEntry"("professionalProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_customerProfileId_createdAt_idx" ON "LedgerEntry"("customerProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
