import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AdminCashPaymentConfirmationModel } from './admin-cash-payment-confirmation.model';

/**
 * Real, bounded pagination for `adminCashPaymentConfirmations` — same
 * `items`/`totalCount`/`limit`/`offset` shape as `AdminLedgerEntriesPageModel`.
 */
@ObjectType()
export class AdminCashPaymentConfirmationsPageModel {
  @Field(() => [AdminCashPaymentConfirmationModel])
  items!: AdminCashPaymentConfirmationModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
