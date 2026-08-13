import { Field, Int, ObjectType } from '@nestjs/graphql';
import { UserAccountModel } from './user-account.model';

/**
 * Real, bounded pagination for `userAccounts` — DELIBERATE, DOCUMENTED
 * phase-1 scope boundary: `limit`/`offset` only (default/max page size
 * enforced server-side by `ListUserAccountsService`, ~200 rows). No
 * server-side filter/sort arguments yet — the admin panel's Tabulator grid
 * does its own client-side filtering/sorting/column operations on the
 * fetched page. This is NOT "fetch everything unbounded"; it is a real,
 * if currently coarse, pagination contract. See
 * `ListUserAccountsService`'s own comment for the same note.
 */
@ObjectType()
export class UserAccountsPageModel {
  @Field(() => [UserAccountModel])
  items!: UserAccountModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
