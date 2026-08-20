import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { ListAdminUsersService } from './services/list-admin-users.service';
import { UpdateAdminUserService } from './services/update-admin-user.service';
import { DeleteAdminUserService } from './services/delete-admin-user.service';
import { AdminUserModel } from './models/admin-user.model';
import { AdminUsersPageModel } from './models/admin-users-page.model';
import { UpdateAdminUserInput } from './models/update-admin-user.input';
import { DeleteAdminUserPayload } from './models/delete-admin-user-payload.model';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver. Both operations require `ADMIN_USERS_MANAGE` —
 * this is about managing OTHER ADMINS (see `AdminUserModel`'s own header
 * comment for the disambiguation from the consumer-facing `UserAccountModel`/
 * `user-accounts/` capability, gated by `USER_ACCOUNTS_*` instead).
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminUsersResolver {
  constructor(
    private readonly listAdminUsersService: ListAdminUsersService,
    private readonly updateAdminUserService: UpdateAdminUserService,
    private readonly deleteAdminUserService: DeleteAdminUserService,
  ) {}

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Query(() => AdminUsersPageModel, {
    description:
      'Lists GoService admin users (this internal panel’s own operators), paginated. Phase-1 scope: limit/offset only, no server-side filter/sort arguments yet.',
  })
  adminUsers(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<AdminUsersPageModel> {
    return this.listAdminUsersService.listAdminUsers(limit, offset);
  }

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Mutation(() => AdminUserModel, {
    description:
      'Partially updates an admin user (only the fields present in the input are changed) — displayName/roleId/status. Rejects setting status to INVITED directly (only reachable via the invite flow), revoking your OWN account (CANNOT_REVOKE_OWN_ACCOUNT), and any edit that would leave zero ACTIVE admins holding ADMIN_USERS_MANAGE (WOULD_LOCK_OUT_ADMIN_MANAGEMENT). Writes an AdminAuditLog row in the same transaction, and is a true no-op when nothing actually changes.',
  })
  updateAdminUser(
    @CurrentAdminUser() adminUserId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateAdminUserInput,
  ): Promise<AdminUserModel> {
    return this.updateAdminUserService.updateAdminUser(adminUserId, id, input);
  }

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Mutation(() => DeleteAdminUserPayload, {
    description:
      'PERMANENTLY deletes an admin user. Rejects deleting your OWN account (CANNOT_DELETE_OWN_ACCOUNT), an admin who has EVER authored an AdminAuditLog row (ADMIN_USER_HAS_AUDIT_HISTORY — revoke them instead; AdminAuditLog.actorAdminUser is onDelete: Restrict, a real DB-level constraint, not just a business rule), and any deletion that would leave zero ACTIVE admins holding ADMIN_USERS_MANAGE (WOULD_LOCK_OUT_ADMIN_MANAGEMENT). Writes an AdminAuditLog row (as the ACTOR performing the deletion, never the deleted target) in the same transaction as the delete. IRREVERSIBLE — unlike updateAdminUser({ status: REVOKED }), which can be undone by setting status back to ACTIVE.',
  })
  deleteAdminUser(
    @CurrentAdminUser() adminUserId: string,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeleteAdminUserPayload> {
    return this.deleteAdminUserService.deleteAdminUser(adminUserId, id);
  }
}
