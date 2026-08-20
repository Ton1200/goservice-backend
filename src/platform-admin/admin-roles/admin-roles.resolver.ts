import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { CreateAdminRoleService } from './services/create-admin-role.service';
import { DeleteAdminRoleService } from './services/delete-admin-role.service';
import { ListAdminRolesService } from './services/list-admin-roles.service';
import { UpdateAdminRolePermissionsService } from './services/update-admin-role-permissions.service';
import { AdminRoleModel } from './models/admin-role.model';
import { CreateAdminRoleInput } from './models/create-admin-role.input';
import { DeleteAdminRolePayload } from './models/delete-admin-role-payload.model';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * Every operation here requires `ADMIN_USERS_MANAGE` — a single permission
 * gates both reading AND writing roles, same criterion `USER_ACCOUNTS_DELETE`
 * already establishes for a comparably sensitive capability (see
 * `scripts/bootstrap-super-admin.ts`'s own comment on this role/permission).
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminRolesResolver {
  constructor(
    private readonly listAdminRolesService: ListAdminRolesService,
    private readonly createAdminRoleService: CreateAdminRoleService,
    private readonly updateAdminRolePermissionsService: UpdateAdminRolePermissionsService,
    private readonly deleteAdminRoleService: DeleteAdminRoleService,
  ) {}

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Query(() => [AdminRoleModel], {
    description:
      'Every AdminRole (the 3 seeded system roles plus any admin-created ones), including its full permission set.',
  })
  adminRoles(): Promise<AdminRoleModel[]> {
    return this.listAdminRolesService.listAdminRoles();
  }

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Mutation(() => AdminRoleModel, {
    description:
      'Creates a new AdminRole with the given name and initial permission set. Rejects a duplicate name (ADMIN_ROLE_NAME_TAKEN). Writes an AdminAuditLog row in the same transaction.',
  })
  createAdminRole(
    @CurrentAdminUser() adminUserId: string,
    @Args('input') input: CreateAdminRoleInput,
  ): Promise<AdminRoleModel> {
    return this.createAdminRoleService.createAdminRole(adminUserId, input);
  }

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Mutation(() => AdminRoleModel, {
    description:
      "Replaces an AdminRole's ENTIRE permission set (full-state, not a partial patch) — applies to all roles including the 3 seeded system roles (by explicit design; only their NAME is protected, never their permissions). Rejected with WOULD_LOCK_OUT_ADMIN_MANAGEMENT if this edit would leave zero ACTIVE admins holding ADMIN_USERS_MANAGE anywhere in the system. Writes an AdminAuditLog row in the same transaction, and is a true no-op when the submitted set is identical to the current one.",
  })
  updateAdminRolePermissions(
    @CurrentAdminUser() adminUserId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('permissions', { type: () => [Permission] })
    permissions: Permission[],
  ): Promise<AdminRoleModel> {
    return this.updateAdminRolePermissionsService.updateAdminRolePermissions(
      adminUserId,
      id,
      permissions,
    );
  }

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Mutation(() => DeleteAdminRolePayload, {
    description:
      'Permanently deletes an AdminRole. Rejected with ADMIN_ROLE_IS_SYSTEM_ROLE for any of the 3 seeded roles, or ADMIN_ROLE_IN_USE if any AdminUser still references it. Writes an AdminAuditLog row in the same transaction.',
  })
  deleteAdminRole(
    @CurrentAdminUser() adminUserId: string,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeleteAdminRolePayload> {
    return this.deleteAdminRoleService.deleteAdminRole(adminUserId, id);
  }
}
