import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { AdminUserStatus } from '../../admin-auth/models/admin-user-status.enum';
import { AdminRoleModel } from '../../admin-roles/models/admin-role.model';

/**
 * Admin-facing GraphQL type for `adminUsers`/`updateAdminUser`/
 * `inviteAdminUser` (`/admin/graphql` only). Distinct from the CONSUMER
 * `UserAccountModel` (`../../user-accounts/models/user-account.model.ts`) —
 * this is about GoService's OWN internal admin accounts, never a customer/
 * professional. `passwordHash` is never a field here — and, more
 * importantly, is never even selected out of Postgres for this capability;
 * see `AdminUsersRepository`'s own `ADMIN_USER_SELECT` for the structural
 * guardrail this relies on.
 */
@ObjectType('AdminUser')
export class AdminUserModel {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  displayName!: string;

  @Field(() => AdminUserStatus)
  status!: AdminUserStatus;

  @Field(() => AdminRoleModel)
  role!: AdminRoleModel;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
