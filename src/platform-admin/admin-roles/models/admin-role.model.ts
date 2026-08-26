import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { Permission } from '../../admin-rbac/admin-permission.enum';

/**
 * The first GraphQL exposure of `AdminRole` (previously an internal-only
 * Prisma model, read via `AdminRolesRepository.findEffectivePermissions`
 * but never itself returned over the wire). Reused by BOTH `adminRoles`
 * (list) and, nested, by `AdminUserModel.role` (`../../admin-users/models/`)
 * — `permissions` is fully readable here, deliberately: an admin with
 * `ADMIN_USERS_MANAGE` needs to see a role's current permission set to
 * build the checkbox-matrix UI `updateAdminRolePermissions` edits.
 */
@ObjectType()
export class AdminRoleModel {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => [Permission])
  permissions!: Permission[];

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
