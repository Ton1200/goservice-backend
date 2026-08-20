import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AdminUserModel } from './admin-user.model';

/** Real, bounded pagination for `adminUsers` — same `limit`/`offset`
 * phase-1-scope convention as `UserAccountsPageModel`. */
@ObjectType()
export class AdminUsersPageModel {
  @Field(() => [AdminUserModel])
  items!: AdminUserModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  offset!: number;
}
