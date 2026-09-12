import { Injectable, Logger } from '@nestjs/common';
import {
  EngagementStatus,
  Prisma,
  Review,
  ReviewCommentModerationStatus,
} from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { engagementNotCompleted } from '../errors/engagement-not-completed.error';
import { engagementReviewAlreadySubmitted } from '../errors/engagement-review-already-submitted.error';
import { invalidReviewRating } from '../errors/invalid-review-rating.error';
import { reviewCommentsDisabled } from '../errors/review-comments-disabled.error';
import { ReviewModel } from '../models/review.model';
import { ReviewsAccessService } from '../reviews-access.service';
import { ReviewsRepository } from '../reviews.repository';

const REVIEW_COMMENT_ENABLED_KEY = 'reviews.comment.enabled';

/**
 * Orchestrates `Mutation.submitEngagementReview`. Same fold anti-enumeration
 * as every other Engagement-scoped mutation — `ReviewsAccessService.resolveParty`
 * throws the reused `ENGAGEMENT_NOT_FOUND` for a nonexistent Engagement OR a
 * third party, BEFORE any of the checks below ever run.
 *
 * Steps:
 *   1. Resolve the caller's party/role on the Engagement.
 *   2. `Engagement.status` must be `COMPLETED` — otherwise
 *      `engagementNotCompleted()`.
 *   3. `rating` must be an integer in `[1, 5]` — validated HERE, not just
 *      trusted from GraphQL's `Int!` (a client can still send `0`/`-3`/`6`).
 *   4. A non-empty (trimmed) `comment` requires the role-independent
 *      `reviews.comment.enabled` flag (read directly here, IN ADDITION to
 *      the module-wide `reviews.rating.enabled` the resolver's own guard
 *      already checked) — same "read a second, more granular flag beyond
 *      the module guard" pattern `PostQuoteNegotiationMessageService`
 *      already establishes for its own role-specific price-proposal flags.
 *      When off, the comment is NEVER silently dropped — the whole mutation
 *      fails with `reviewCommentsDisabled()`. An empty/whitespace-only
 *      comment is treated as "no comment" regardless of the flag.
 *   5. `create()` directly (no pre-check `findFirst`) — the FIRST place in
 *      this codebase that catches a Prisma `P2002` directly instead of a
 *      pre-check/CAS, a deliberate exception instructed by the ticket
 *      itself (`Review`'s own `@@unique([engagementId, authorRole])` is
 *      the whole guarantee; no transactional CAS is needed since this is a
 *      single-row `create`, not a state transition).
 *
 * The returned `ReviewModel.comment` is the AUTHOR'S OWN just-submitted
 * text, verbatim — double-blind/moderation visibility rules apply ONLY to
 * the COUNTERPARTY reading it back via `myReceivedReviews`
 * (`ListMyReceivedReviewsService`), never to this mutation's own response:
 * an author always sees exactly what they just wrote.
 */
@Injectable()
export class SubmitEngagementReviewService {
  private readonly logger = new Logger(SubmitEngagementReviewService.name);

  constructor(
    private readonly reviewsAccessService: ReviewsAccessService,
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly reviewsRepository: ReviewsRepository,
  ) {}

  async submit(
    userId: string,
    engagementId: string,
    rating: number,
    comment: string | null | undefined,
  ): Promise<ReviewModel> {
    const party = await this.reviewsAccessService.resolveParty(
      userId,
      engagementId,
    );

    if (party.engagement.status !== EngagementStatus.COMPLETED) {
      throw engagementNotCompleted();
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw invalidReviewRating();
    }

    const trimmedComment = comment?.trim() ?? '';
    let finalComment: string | null = null;
    let commentModerationStatus: ReviewCommentModerationStatus | null = null;
    if (trimmedComment.length > 0) {
      const commentsEnabled = await this.platformSettingPort.isEnabled(
        REVIEW_COMMENT_ENABLED_KEY,
      );
      if (!commentsEnabled) {
        throw reviewCommentsDisabled();
      }
      finalComment = trimmedComment;
      commentModerationStatus = ReviewCommentModerationStatus.PENDING;
    }

    let created: Review;
    try {
      created = await this.reviewsRepository.create({
        engagementId,
        authorRole: party.role,
        authorCustomerProfileId: party.customerProfileId,
        authorProfessionalProfileId: party.professionalProfileId,
        rating,
        comment: finalComment,
        commentModerationStatus,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw engagementReviewAlreadySubmitted();
      }
      throw error;
    }

    this.logger.log({
      event: 'engagement_review_submitted',
      outcome: 'success',
      engagementId,
      reviewId: created.id,
      authorRole: party.role,
      hasComment: finalComment !== null,
    });

    const model = new ReviewModel();
    model.id = created.id;
    model.engagementId = created.engagementId;
    model.authorRole = created.authorRole;
    model.rating = created.rating;
    model.comment = created.comment;
    model.createdAt = created.createdAt;
    return model;
  }
}
