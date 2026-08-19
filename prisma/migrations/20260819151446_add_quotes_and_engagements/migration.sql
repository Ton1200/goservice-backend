-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('SENT', 'WITHDRAWN', 'REJECTED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('ACCEPTED');

-- AlterEnum
ALTER TYPE "ServiceRequestStatus" ADD VALUE 'ENGAGED';

-- AlterTable
ALTER TABLE "ServiceRequest" ADD COLUMN     "acceptedQuoteId" UUID;

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "price" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'SENT',
    "withdrawnAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "customerProfileId" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "status" "EngagementStatus" NOT NULL DEFAULT 'ACCEPTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quote_serviceRequestId_status_idx" ON "Quote"("serviceRequestId", "status");

-- CreateIndex
CREATE INDEX "Quote_professionalProfileId_createdAt_idx" ON "Quote"("professionalProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_serviceRequestId_key" ON "Engagement"("serviceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_quoteId_key" ON "Engagement"("quoteId");

-- CreateIndex
CREATE INDEX "Engagement_customerProfileId_createdAt_idx" ON "Engagement"("customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "Engagement_professionalProfileId_createdAt_idx" ON "Engagement"("professionalProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_acceptedQuoteId_key" ON "ServiceRequest"("acceptedQuoteId");

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_acceptedQuoteId_fkey" FOREIGN KEY ("acceptedQuoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
