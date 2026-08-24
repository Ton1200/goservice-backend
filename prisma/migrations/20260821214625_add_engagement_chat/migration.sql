-- CreateEnum
CREATE TYPE "EngagementChatParty" AS ENUM ('CUSTOMER', 'PROFESSIONAL');

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'ENGAGEMENT_CHAT_READ';

-- CreateTable
CREATE TABLE "EngagementChatConversation" (
    "id" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementChatMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderRole" "EngagementChatParty" NOT NULL,
    "senderCustomerProfileId" UUID,
    "senderProfessionalProfileId" UUID,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngagementChatConversation_engagementId_key" ON "EngagementChatConversation"("engagementId");

-- CreateIndex
CREATE INDEX "EngagementChatMessage_conversationId_createdAt_idx" ON "EngagementChatMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "EngagementChatConversation" ADD CONSTRAINT "EngagementChatConversation_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementChatMessage" ADD CONSTRAINT "EngagementChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "EngagementChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementChatMessage" ADD CONSTRAINT "EngagementChatMessage_senderCustomerProfileId_fkey" FOREIGN KEY ("senderCustomerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementChatMessage" ADD CONSTRAINT "EngagementChatMessage_senderProfessionalProfileId_fkey" FOREIGN KEY ("senderProfessionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GOS-46 — structural guardrail, same precedent as
-- `quote_negotiation_message_author_shape_check`: makes it physically
-- impossible to persist an EngagementChatMessage whose sender-identifying
-- columns don't match its declared senderRole, not just an
-- application-code discipline. Exactly one of senderCustomerProfileId/
-- senderProfessionalProfileId must be non-null, and it must be the one
-- matching senderRole.
ALTER TABLE "EngagementChatMessage" ADD CONSTRAINT "engagement_chat_message_sender_shape_check" CHECK (
  (
    "senderRole" = 'CUSTOMER'
    AND "senderCustomerProfileId" IS NOT NULL
    AND "senderProfessionalProfileId" IS NULL
  )
  OR (
    "senderRole" = 'PROFESSIONAL'
    AND "senderProfessionalProfileId" IS NOT NULL
    AND "senderCustomerProfileId" IS NULL
  )
);
