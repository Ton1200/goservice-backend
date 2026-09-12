import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { ReviewsModuleEnabledGuard } from './guards/reviews-module-enabled.guard';
import { ReviewModel } from './models/review.model';
import { SubmitEngagementReviewService } from './services/submit-engagement-review.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `QuoteNegotiationResolver`. Carries ONLY `submitEngagementReview`, gated
 * by `SessionGuard`, `AccountApprovedGuard`, AND `ReviewsModuleEnabledGuard`
 * (in that exact order). `myReceivedReviews` deliberately lives on a
 * SEPARATE class (`ReviewsQueriesResolver`) — see that class's own header
 * comment for why splitting these two operations across two resolver
 * classes is the correct way to give them different guard chains under
 * NestJS (a class-level `@UseGuards` applies to every method in that class;
 * there is no clean per-method "opt out" of a class-level guard).
 *
 * Never accepts `customerProfileId`/`professionalProfileId`/`userId` as an
 * argument — ownership/role is always derived server-side from
 * `@CurrentUser()` + `ReviewsAccessService`.
 */
@Resolver()
@UseGuards(SessionGuard, AccountApprovedGuard, ReviewsModuleEnabledGuard)
export class ReviewsResolver {
  constructor(
    private readonly submitEngagementReviewService: SubmitEngagementReviewService,
  ) {}

  @Mutation(() => ReviewModel, {
    description:
      "Rates the counterparty of a COMPLETED Engagement the caller is a party to — 1-5 stars plus an optional comment. Each party may submit exactly once per Engagement (ENGAGEMENT_REVIEW_ALREADY_SUBMITTED on a second attempt). A non-empty comment is held PENDING admin moderation before the counterparty can read it; the rating is never moderated. The response always shows the caller's OWN just-submitted comment verbatim — double-blind/moderation visibility only applies when the COUNTERPARTY reads it back via myReceivedReviews.",
  })
  submitEngagementReview(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
    @Args('rating', { type: () => Int }) rating: number,
    @Args('comment', { type: () => String, nullable: true })
    comment?: string | null,
  ): Promise<ReviewModel> {
    return this.submitEngagementReviewService.submit(
      userId,
      engagementId,
      rating,
      comment,
    );
  }
}
