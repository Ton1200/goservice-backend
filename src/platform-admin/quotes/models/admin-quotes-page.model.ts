import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AdminQuoteModel } from './admin-quote.model';

/**
 * Real, bounded pagination for `quotes` — same DELIBERATE, DOCUMENTED
 * phase-1 scope boundary as `AdminServiceRequestsPageModel`: `limit`/
 * `offset` only (server-enforced max page size), no server-side filter/sort
 * arguments yet. The admin panel's Tabulator grid does its own client-side
 * filtering/sorting on the fetched page.
 */
@ObjectType()
export class AdminQuotesPageModel {
  @Field(() => [AdminQuoteModel])
  items!: AdminQuoteModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
