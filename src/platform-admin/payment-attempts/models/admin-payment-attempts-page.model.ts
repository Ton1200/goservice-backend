import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AdminPaymentAttemptModel } from './admin-payment-attempt.model';

/**
 * Real, bounded pagination for `adminPaymentAttempts` — same
 * `items`/`totalCount`/`limit`/`offset` shape as
 * `AdminLedgerEntriesPageModel`.
 */
@ObjectType()
export class AdminPaymentAttemptsPageModel {
  @Field(() => [AdminPaymentAttemptModel])
  items!: AdminPaymentAttemptModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
