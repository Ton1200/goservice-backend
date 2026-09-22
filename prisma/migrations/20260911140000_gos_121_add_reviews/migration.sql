-- GOS-121 — mutual Engagement ratings/reviews, with admin comment
-- moderation. See Review's own header comment in prisma/schema.prisma for
-- the full design.

-- CreateEnum
CREATE TYPE "EngagementReviewParty" AS ENUM ('CUSTOMER', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "ReviewCommentModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
-- Every existing Engagement row keeps completedAt = NULL — no backfill (no
-- existing COMPLETED row has a real completion moment to reconstruct), same
-- accepted "nullable retroactive column" criterion this repo already uses
-- (e.g. 20260826120000_add_location_sharing_consent_flag).
ALTER TABLE "Engagement" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "engagementId" UUID NOT NULL,
    "authorRole" "EngagementReviewParty" NOT NULL,
    "authorCustomerProfileId" UUID,
    "authorProfessionalProfileId" UUID,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "commentModerationStatus" "ReviewCommentModerationStatus",
    "moderatedByAdminUserId" UUID,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The physical "each party may rate a given Engagement at most once"
-- constraint — see SubmitEngagementReviewService's own header comment for
-- why this is caught via Prisma P2002, not a pre-check.
CREATE UNIQUE INDEX "Review_engagementId_authorRole_key" ON "Review"("engagementId", "authorRole");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorCustomerProfileId_fkey" FOREIGN KEY ("authorCustomerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorProfessionalProfileId_fkey" FOREIGN KEY ("authorProfessionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull — same pattern as the 3 existing updatedByAdminUserId FKs
-- (PlatformSetting/EmailTemplate/EmailLayout): an admin account being
-- deleted must never block/cascade-delete a Review.
ALTER TABLE "Review" ADD CONSTRAINT "Review_moderatedByAdminUserId_fkey" FOREIGN KEY ("moderatedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'REVIEWS_READ';

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'REVIEWS_WRITE';

-- GOS-121 — structural guardrail, same precedent as
-- `quote_negotiation_message_author_shape_check`: makes it physically
-- impossible to persist a Review whose author-identifying columns don't
-- match its declared authorRole.
ALTER TABLE "Review" ADD CONSTRAINT "review_author_shape_check" CHECK (
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

-- GOS-121 — decision taken explicitly (see the plan/domain-model.md): a REAL
-- CHECK constraint, not just application-layer discipline, same "make an
-- invariant physically impossible" criterion this repo already applies 3
-- times (quote_negotiation_message_author_shape_check /
-- quote_price_proposal_proposed_by_shape_check /
-- quote_price_proposal_resolved_by_shape_check /
-- platform_setting_encrypted_shape_check). `commentModerationStatus` must be
-- NULL exactly when `comment` is NULL — nothing to moderate when there is no
-- comment, and always SOMETHING to moderate (at least PENDING) the instant a
-- comment exists.
ALTER TABLE "Review" ADD CONSTRAINT "review_comment_moderation_status_shape_check" CHECK (
  ("comment" IS NULL AND "commentModerationStatus" IS NULL)
  OR ("comment" IS NOT NULL AND "commentModerationStatus" IS NOT NULL)
);
