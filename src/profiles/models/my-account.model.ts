import { Field, ObjectType } from '@nestjs/graphql';
import { UserAccountStatus } from '../../users/models/user-account-status.enum';

/**
 * The authenticated user's own account-level state — a small, deliberately
 * separate `@ObjectType()` from `CustomerProfile`/`ProfessionalProfile`
 * (which describe a specific PROFILE, not the account itself). Only
 * `accountStatus` today, but shaped as a proper object type (not a bare
 * `UserAccountStatus!` scalar return on `Query.myAccount`) so more
 * account-level fields can be added later — additively, without a breaking
 * change to `myAccount`'s return shape.
 */
@ObjectType()
export class MyAccount {
  @Field(() => UserAccountStatus)
  accountStatus!: UserAccountStatus;
}
