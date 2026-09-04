-- GOS-72 — images on Quote (QuoteAttachment, 1:N), Quote-negotiation message
-- (imageUrl) and Engagement-chat message (imageUrl), all backed by ONE new
-- shared MediaUploadRef table discriminated by intendedUse. Purely additive.
-- GOS-38's "ServiceRequestAttachment" / "ServiceRequestAttachmentUploadRef"
-- tables are intentionally NOT touched by this migration.

-- CreateEnum
CREATE TYPE "MediaUploadRefIntendedUse" AS ENUM ('QUOTE_ATTACHMENT', 'QUOTE_NEGOTIATION_MESSAGE_IMAGE', 'ENGAGEMENT_CHAT_MESSAGE_IMAGE');

-- CreateEnum
CREATE TYPE "MediaUploadRefStatus" AS ENUM ('PENDING', 'CONSUMED');

-- AlterTable
ALTER TABLE "EngagementChatMessage" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "QuoteNegotiationMessage" ADD COLUMN     "imageUrl" TEXT;

-- CreateTable
CREATE TABLE "QuoteAttachment" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaUploadRef" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "intendedUse" "MediaUploadRefIntendedUse" NOT NULL,
    "status" "MediaUploadRefStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaUploadRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteAttachment_quoteId_idx" ON "QuoteAttachment"("quoteId");

-- CreateIndex
CREATE INDEX "MediaUploadRef_userId_status_idx" ON "MediaUploadRef"("userId", "status");

-- AddForeignKey
ALTER TABLE "QuoteAttachment" ADD CONSTRAINT "QuoteAttachment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUploadRef" ADD CONSTRAINT "MediaUploadRef_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
