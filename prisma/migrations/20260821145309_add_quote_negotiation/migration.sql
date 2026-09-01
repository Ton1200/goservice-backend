-- CreateEnum
CREATE TYPE "QuoteNegotiationParty" AS ENUM ('CUSTOMER', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "QuotePriceProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "negotiatedPrice" INTEGER;

-- CreateTable
CREATE TABLE "QuoteNegotiationMessage" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "authorRole" "QuoteNegotiationParty" NOT NULL,
    "authorCustomerProfileId" UUID,
    "authorProfessionalProfileId" UUID,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteNegotiationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotePriceProposal" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "negotiationMessageId" UUID NOT NULL,
    "proposedByRole" "QuoteNegotiationParty" NOT NULL,
    "proposedByCustomerProfileId" UUID,
    "proposedByProfessionalProfileId" UUID,
    "proposedPrice" INTEGER NOT NULL,
    "status" "QuotePriceProposalStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedByCustomerProfileId" UUID,
    "resolvedByProfessionalProfileId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotePriceProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteNegotiationMessage_quoteId_createdAt_idx" ON "QuoteNegotiationMessage"("quoteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuotePriceProposal_negotiationMessageId_key" ON "QuotePriceProposal"("negotiationMessageId");

-- CreateIndex
CREATE INDEX "QuotePriceProposal_quoteId_status_idx" ON "QuotePriceProposal"("quoteId", "status");

-- AddForeignKey
ALTER TABLE "QuoteNegotiationMessage" ADD CONSTRAINT "QuoteNegotiationMessage_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteNegotiationMessage" ADD CONSTRAINT "QuoteNegotiationMessage_authorCustomerProfileId_fkey" FOREIGN KEY ("authorCustomerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteNegotiationMessage" ADD CONSTRAINT "QuoteNegotiationMessage_authorProfessionalProfileId_fkey" FOREIGN KEY ("authorProfessionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePriceProposal" ADD CONSTRAINT "QuotePriceProposal_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePriceProposal" ADD CONSTRAINT "QuotePriceProposal_negotiationMessageId_fkey" FOREIGN KEY ("negotiationMessageId") REFERENCES "QuoteNegotiationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePriceProposal" ADD CONSTRAINT "QuotePriceProposal_proposedByCustomerProfileId_fkey" FOREIGN KEY ("proposedByCustomerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePriceProposal" ADD CONSTRAINT "QuotePriceProposal_proposedByProfessionalProfileId_fkey" FOREIGN KEY ("proposedByProfessionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePriceProposal" ADD CONSTRAINT "QuotePriceProposal_resolvedByCustomerProfileId_fkey" FOREIGN KEY ("resolvedByCustomerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePriceProposal" ADD CONSTRAINT "QuotePriceProposal_resolvedByProfessionalProfileId_fkey" FOREIGN KEY ("resolvedByProfessionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GOS-53 — structural guardrail, same precedent as
-- `platform_setting_encrypted_shape_check`: makes it physically impossible
-- to persist a QuoteNegotiationMessage whose author-identifying columns
-- don't match its declared authorRole, not just an application-code
-- discipline. Exactly one of authorCustomerProfileId/
-- authorProfessionalProfileId must be non-null, and it must be the one
-- matching authorRole.
ALTER TABLE "QuoteNegotiationMessage" ADD CONSTRAINT "quote_negotiation_message_author_shape_check" CHECK (
  (
    "authorRole" = 'CUSTOMER'
    AND "authorCustomerProfileId" IS NOT NULL
    AND "authorProfessionalProfileId" IS NULL
  )
  OR (
    "authorRole" = 'PROFESSIONAL'
    AND "authorProfessionalProfileId" IS NOT NULL
    AND "authorCustomerProfileId" IS NULL
  )
);

-- GOS-53 — same guardrail for QuotePriceProposal.proposedByRole.
ALTER TABLE "QuotePriceProposal" ADD CONSTRAINT "quote_price_proposal_proposed_by_shape_check" CHECK (
  (
    "proposedByRole" = 'CUSTOMER'
    AND "proposedByCustomerProfileId" IS NOT NULL
    AND "proposedByProfessionalProfileId" IS NULL
  )
  OR (
    "proposedByRole" = 'PROFESSIONAL'
    AND "proposedByProfessionalProfileId" IS NOT NULL
    AND "proposedByCustomerProfileId" IS NULL
  )
);

-- GOS-53 — resolvedBy* is set ONLY on accept/reject (both null while
-- PENDING/SUPERSEDED), and, when set, exactly one of the pair must be
-- non-null (see this model's own header comment: no separate resolvedByRole
-- column — which pair is non-null already says who resolved it).
ALTER TABLE "QuotePriceProposal" ADD CONSTRAINT "quote_price_proposal_resolved_by_shape_check" CHECK (
  (
    "status" IN ('PENDING', 'SUPERSEDED')
    AND "resolvedByCustomerProfileId" IS NULL
    AND "resolvedByProfessionalProfileId" IS NULL
  )
  OR (
    "status" IN ('ACCEPTED', 'REJECTED')
    AND (
      ("resolvedByCustomerProfileId" IS NOT NULL AND "resolvedByProfessionalProfileId" IS NULL)
      OR ("resolvedByCustomerProfileId" IS NULL AND "resolvedByProfessionalProfileId" IS NOT NULL)
    )
  )
);
