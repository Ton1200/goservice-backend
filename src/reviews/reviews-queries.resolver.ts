import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { ReviewModel } from './models/review.model';
import { ListMyReceivedReviewsService } from './services/list-my-received-reviews.service';

/**
 * Carries ONLY `myReceivedReviews` — deliberately a SEPARATE resolver class
 * from `ReviewsResolver`, WITHOUT `ReviewsModuleEnabledGuard` in its guard
 * chain (only `SessionGuard`/`AccountApprovedGuard`). This is a deliberate
 * divergence from the `EngagementChatResolver`/`QuoteNegotiationResolver`
 * precedent, where the read query DOES share its module's kill-switch
 * guard — driven by this ticket's own explicit requirement: turning
 * `reviews.rating.enabled` off must disable NEW submissions only, never
 * hide reviews a caller has already received. Splitting into two resolver
 * classes is the clean way to give one query a different guard chain than
 * a sibling mutation under NestJS's class-level `@UseGuards`.
 */
@Resolver()
@UseGuards(SessionGuard, AccountApprovedGuard)
export class ReviewsQueriesResolver {
  constructor(
    private readonly listMyReceivedReviewsService: ListMyReceivedReviewsService,
  ) {}

  @Query(() => [ReviewModel], {
    description:
      'Every Review the caller has RECEIVED from a counterparty, whose double-blind has resolved (the caller has also rated that same Engagement, or 14 days have passed since Engagement.completedAt). NOT gated by any reviews.* feature flag — disabling new submissions never hides reviews already received. comment is null unless its moderation is APPROVED; rating is always visible once the double-blind resolves.',
  })
  myReceivedReviews(@CurrentUser() userId: string): Promise<ReviewModel[]> {
    return this.listMyReceivedReviewsService.listReceived(userId);
  }
}
