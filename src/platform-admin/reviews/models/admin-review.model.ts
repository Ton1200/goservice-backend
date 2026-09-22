import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { EngagementReviewParty } from '../../../reviews/models/engagement-review-party.enum';
import { ReviewCommentModerationStatus } from '../../../reviews/models/review-comment-moderation-status.enum';

/**
 * Admin-facing GraphQL type for `adminReviews`/`moderateEngagementReviewComment`
 * (`/admin/graphql` only — never the consumer schema), gated by
 * `Permission.REVIEWS_READ`/`REVIEWS_WRITE`. Unlike the public `ReviewModel`,
 * `comment` here is ALWAYS the raw stored text (never nulled out by
 * moderation status) — an admin auditing/moderating a comment must be able
 * to read it regardless of its current `commentModerationStatus`. Also
 * exposes `commentModerationStatus`/`moderatedByAdminUserId`/`moderatedAt`,
 * all admin-only concerns absent from `ReviewModel`.
 */
@ObjectType('AdminReview')
export class AdminReviewModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  engagementId!: string;

  @Field(() => EngagementReviewParty)
  authorRole!: EngagementReviewParty;

  @Field(() => Int)
  rating!: number;

  @Field(() => String, { nullable: true })
  comment!: string | null;

  @Field(() => ReviewCommentModerationStatus, { nullable: true })
  commentModerationStatus!: ReviewCommentModerationStatus | null;

  @Field(() => ID, { nullable: true })
  moderatedByAdminUserId!: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  moderatedAt!: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
