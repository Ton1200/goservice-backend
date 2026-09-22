import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { EngagementReviewParty } from './engagement-review-party.enum';

/**
 * The PUBLIC shape of a Review — GOS-121. Deliberately carries NO
 * `commentModerationStatus`/`moderatedByAdminUserId`/`moderatedAt` field:
 * those are admin-only concerns, exposed exclusively via
 * `AdminReviewModel` (`src/platform-admin/reviews/`). `comment`'s
 * visibility here is ALREADY RESOLVED by the caller (see
 * `SubmitEngagementReviewService`/`ListMyReceivedReviewsService`'s own
 * header comments) — by the time a `ReviewModel` is constructed, `comment`
 * is either the real text or `null`, and this class has no way to tell
 * which case it is.
 */
@ObjectType('Review')
export class ReviewModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  engagementId!: string;

  @Field(() => EngagementReviewParty)
  authorRole!: EngagementReviewParty;

  @Field(() => Int)
  rating!: number;

  // `null` when no comment was submitted, OR when one was submitted but its
  // visibility hasn't resolved for THIS caller yet (see
  // `ListMyReceivedReviewsService`) — the two cases are indistinguishable on
  // this public model by design.
  @Field(() => String, { nullable: true })
  comment?: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
