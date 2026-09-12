import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AdminReviewModel } from './admin-review.model';

/**
 * Real, bounded pagination for `adminReviews` — same shape as
 * `AdminServiceRequestsPageModel`: `items`/`totalCount`/`limit`/`offset`,
 * PLUS the optional server-side `AdminReviewsFilterInput` (see that class's
 * own comment for why this grid is the first to need one).
 */
@ObjectType()
export class AdminReviewsPageModel {
  @Field(() => [AdminReviewModel])
  items!: AdminReviewModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
