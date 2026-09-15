import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AdminEngagementPaymentSummaryModel } from './admin-engagement-payment-summary.model';

/**
 * Same `items`/`totalCount`/`limit`/`offset` shape as
 * `AdminLedgerEntriesPageModel` — see
 * `LedgerRepository.findManyForAdminPaymentSummaries`'s own comment for the
 * documented phase-1 pagination scope boundary `totalCount` here inherits.
 */
@ObjectType()
export class AdminEngagementPaymentSummariesPageModel {
  @Field(() => [AdminEngagementPaymentSummaryModel])
  items!: AdminEngagementPaymentSummaryModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
