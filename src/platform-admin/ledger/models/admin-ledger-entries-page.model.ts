import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AdminLedgerEntryModel } from './admin-ledger-entry.model';

/**
 * Real, bounded pagination for `adminLedgerEntries` — same
 * `items`/`totalCount`/`limit`/`offset` shape as `AdminReviewsPageModel`.
 */
@ObjectType()
export class AdminLedgerEntriesPageModel {
  @Field(() => [AdminLedgerEntryModel])
  items!: AdminLedgerEntryModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
