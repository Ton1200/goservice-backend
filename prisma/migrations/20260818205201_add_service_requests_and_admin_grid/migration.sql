-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceRequestUrgency" AS ENUM ('FLEXIBLE', 'THIS_WEEK', 'URGENT');

-- CreateEnum
CREATE TYPE "ServiceRequestAttachmentUploadRefStatus" AS ENUM ('PENDING', 'CONSUMED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Permission" ADD VALUE 'SERVICE_REQUESTS_READ';
ALTER TYPE "Permission" ADD VALUE 'SERVICE_REQUESTS_WRITE';

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" UUID NOT NULL,
    "customerProfileId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "urgency" "ServiceRequestUrgency" NOT NULL,
    "indicativeBudgetMin" INTEGER,
    "indicativeBudgetMax" INTEGER,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequestAttachment" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequestAttachmentUploadRef" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "ServiceRequestAttachmentUploadRefStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "serviceRequestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRequestAttachmentUploadRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceRequest_customerProfileId_createdAt_idx" ON "ServiceRequest"("customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_categoryId_idx" ON "ServiceRequest"("status", "categoryId");

-- CreateIndex
CREATE INDEX "ServiceRequestAttachment_serviceRequestId_idx" ON "ServiceRequestAttachment"("serviceRequestId");

-- CreateIndex
CREATE INDEX "ServiceRequestAttachmentUploadRef_userId_status_idx" ON "ServiceRequestAttachmentUploadRef"("userId", "status");

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequestAttachment" ADD CONSTRAINT "ServiceRequestAttachment_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequestAttachmentUploadRef" ADD CONSTRAINT "ServiceRequestAttachmentUploadRef_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequestAttachmentUploadRef" ADD CONSTRAINT "ServiceRequestAttachmentUploadRef_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
