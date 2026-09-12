import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminReviewModel } from './models/admin-review.model';
import { AdminReviewsFilterInput } from './models/admin-reviews-filter-input.model';
import { AdminReviewsPageModel } from './models/admin-reviews-page.model';
import { ReviewModerationDecision } from './models/review-moderation-decision.enum';
import { ListAdminReviewsService } from './services/list-admin-reviews.service';
import { ModerateEngagementReviewCommentService } from './services/moderate-engagement-review-comment.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `adminReviews` requires `Permission.REVIEWS_READ`;
 * `moderateEngagementReviewComment` requires `Permission.REVIEWS_WRITE` —
 * two genuinely NEW, dedicated permissions (see the `Permission` enum's own
 * comment in `prisma/schema.prisma`), not reused from any sibling surface.
 *
 * No module-enabled kill switch here — `adminReviews` is deliberately NOT
 * gated by `reviews.rating.enabled`/`reviews.comment.enabled` (see
 * `ListAdminReviewsService`'s own header comment for the reasoning, and the
 * explicit contrast with `adminQuoteNegotiationThread`, which IS gated).
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminReviewsResolver {
  constructor(
    private readonly listAdminReviewsService: ListAdminReviewsService,
    private readonly moderateEngagementReviewCommentService: ModerateEngagementReviewCommentService,
  ) {}

  @RequireAdminPermissions(Permission.REVIEWS_READ)
  @Query(() => AdminReviewsPageModel, {
    description:
      'Lists every Review across every Engagement, paginated, optionally filtered by commentModerationStatus/engagementId/professionalProfileId — including PENDING/REJECTED comments the public schema never exposes. Never gated by reviews.rating.enabled/reviews.comment.enabled: an admin can audit/moderate regardless of either flag.',
  })
  adminReviews(
    @Args('filter', { nullable: true }) filter?: AdminReviewsFilterInput,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<AdminReviewsPageModel> {
    return this.listAdminReviewsService.listReviews(filter, limit, offset);
  }

  @RequireAdminPermissions(Permission.REVIEWS_WRITE)
  @Mutation(() => AdminReviewModel, {
    description:
      'Approves or rejects a PENDING review comment. The numeric rating is never affected. Only ever applicable while commentModerationStatus is PENDING — REVIEW_COMMENT_ALREADY_MODERATED otherwise (a decision, once made, is never reverted or reconsidered). Writes an AdminAuditLog row in the same transaction.',
  })
  moderateEngagementReviewComment(
    @CurrentAdminUser() adminUserId: string,
    @Args('reviewId', { type: () => ID }) reviewId: string,
    @Args('decision', { type: () => ReviewModerationDecision })
    decision: ReviewModerationDecision,
  ): Promise<AdminReviewModel> {
    return this.moderateEngagementReviewCommentService.moderate(
      adminUserId,
      reviewId,
      decision,
    );
  }
}
