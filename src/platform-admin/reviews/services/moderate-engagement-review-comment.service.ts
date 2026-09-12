import { Injectable, Logger } from '@nestjs/common';
import { ReviewCommentModerationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { reviewCommentAlreadyModerated } from '../../../reviews/errors/review-comment-already-moderated.error';
import { reviewNotFound } from '../../../reviews/errors/review-not-found.error';
import { ReviewsRepository } from '../../../reviews/reviews.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { AdminReviewModel } from '../models/admin-review.model';
import { ReviewModerationDecision } from '../models/review-moderation-decision.enum';
import { toAdminReviewModel } from '../models/to-admin-review-model.util';

/**
 * Orchestrates `Mutation.moderateEngagementReviewComment`. Owns the
 * transaction boundary itself (injects `PrismaService` directly, same
 * pattern `CreateServiceRequestForCustomerService` already establishes)
 * since it spans two tables (`Review`, `AdminAuditLog`) that must commit
 * atomically or not at all.
 *
 * 1. `reviewId` must resolve to a real `Review` — otherwise `reviewNotFound()`.
 * 2. `commentModerationStatus` must currently be `PENDING` — otherwise
 *    `reviewCommentAlreadyModerated()`. A decision is NEVER reverted or
 *    reconsidered (no un-approve/un-reject) — this pre-check, not a guarded
 *    CAS, is the enforcement (see `ReviewsRepository.updateModeration`'s own
 *    comment for why this ticket's own described shape doesn't call for the
 *    Engagement-state-machine's CAS convention here).
 * 3. Inside one `$transaction`: updates `Review.commentModerationStatus`/
 *    `moderatedByAdminUserId`/`moderatedAt`, then writes an `AdminAuditLog`
 *    row (`REVIEW_COMMENT_APPROVED`/`REVIEW_COMMENT_REJECTED`) via
 *    `AuditLogRepository.write(tx, ...)` — same shape as
 *    `CreateServiceRequestForCustomerService`.
 *
 * The `rating` is NEVER touched here — only `comment`'s moderation status.
 */
@Injectable()
export class ModerateEngagementReviewCommentService {
  private readonly logger = new Logger(
    ModerateEngagementReviewCommentService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewsRepository: ReviewsRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async moderate(
    adminUserId: string,
    reviewId: string,
    decision: ReviewModerationDecision,
  ): Promise<AdminReviewModel> {
    const review = await this.reviewsRepository.findByIdForAdmin(reviewId);
    if (!review) {
      throw reviewNotFound();
    }
    if (
      review.commentModerationStatus !== ReviewCommentModerationStatus.PENDING
    ) {
      throw reviewCommentAlreadyModerated();
    }

    const newStatus =
      decision === ReviewModerationDecision.APPROVE
        ? ReviewCommentModerationStatus.APPROVED
        : ReviewCommentModerationStatus.REJECTED;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.reviewsRepository.updateModeration(tx, reviewId, {
        commentModerationStatus: newStatus,
        moderatedByAdminUserId: adminUserId,
        moderatedAt: new Date(),
      });

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action:
          decision === ReviewModerationDecision.APPROVE
            ? 'REVIEW_COMMENT_APPROVED'
            : 'REVIEW_COMMENT_REJECTED',
        targetType: 'Review',
        targetKey: reviewId,
        metadata: {
          engagementId: review.engagementId,
          previousStatus: 'PENDING',
        },
      });

      return row;
    });

    this.logger.log({
      event: 'engagement_review_comment_moderated',
      outcome: 'success',
      reviewId,
      decision,
    });

    return toAdminReviewModel(updated);
  }
}
