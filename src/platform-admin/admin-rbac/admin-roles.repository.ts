import { Injectable } from '@nestjs/common';
import { AdminRole, AdminUserStatus, Permission, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AdminUserEffectivePermissions {
  status: AdminUserStatus;
  permissions: Permission[];
}

/** One `ACTIVE` `AdminUser` + the permissions its current role grants — the
 * base read `AdminLockoutGuardService` evaluates every lockout hypothetical
 * against. */
export interface ActiveAdminUserEffectivePermissionsRow {
  adminUserId: string;
  roleId: string;
  permissions: Permission[];
}

/**
 * The permission-lookup read path for `AdminRbacService`
 * (`services/admin-rbac.service.ts`), and — since the Administrators-tab
 * follow-up (2026-08-20) — the full `AdminRole` read/write path backing
 * `adminRoles`/`createAdminRole`/`updateAdminRolePermissions`/
 * `deleteAdminRole` AND `AdminLockoutGuardService`'s own read
 * (`listActiveAdminUsersWithEffectivePermissions`). Physically starts from
 * `AdminUser` for `findEffectivePermissions` (an admin's permissions only
 * make sense joined through the role they currently hold), but that one
 * query only ever SELECTs `status` + `role.permissions` — never any other
 * `AdminUser` column — so it stays a narrow, RBAC-scoped read, distinct from
 * `../admin-auth/admin-users.repository.ts`'s own (differently-shaped)
 * `AdminUser` reads. Both live inside the same `PlatformAdminModule` DI
 * graph, so this isn't a cross-module data-ownership violation — see
 * goservice-docs/architecture/backend.md's "Data ownership within one
 * shared database", which scopes that rule to separate top-level modules.
 */
@Injectable()
export class AdminRolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findEffectivePermissions(
    adminUserId: string,
  ): Promise<AdminUserEffectivePermissions | null> {
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { status: true, role: { select: { permissions: true } } },
    });
    if (!adminUser) {
      return null;
    }
    return {
      status: adminUser.status,
      permissions: adminUser.role.permissions,
    };
  }

  findAll(): Promise<AdminRole[]> {
    return this.prisma.adminRole.findMany({ orderBy: { name: 'asc' } });
  }

  findById(id: string): Promise<AdminRole | null> {
    return this.prisma.adminRole.findUnique({ where: { id } });
  }

  findByName(name: string): Promise<AdminRole | null> {
    return this.prisma.adminRole.findUnique({ where: { name } });
  }

  /** Runs inside the caller's own `$transaction` (`CreateAdminRoleService`)
   * — same pattern as `ProfilesRepository.createCategoryForAdmin`: the
   * `AdminRole` create and the `AdminAuditLog` write commit atomically or
   * not at all. */
  create(
    tx: Prisma.TransactionClient,
    data: { name: string; permissions: Permission[] },
  ): Promise<AdminRole> {
    return tx.adminRole.create({ data });
  }

  /** Runs inside the caller's own `$transaction`
   * (`UpdateAdminRolePermissionsService`). Full-state — `permissions`
   * always replaces the entire array, never a partial patch (mirrors
   * `SetPlatformSettingInput`'s own "always full state" convention for a
   * checkbox-matrix-shaped input). */
  updatePermissions(
    tx: Prisma.TransactionClient,
    id: string,
    permissions: Permission[],
  ): Promise<AdminRole> {
    return tx.adminRole.update({ where: { id }, data: { permissions } });
  }

  /** Runs inside the caller's own `$transaction` (`DeleteAdminRoleService`),
   * AFTER that same transaction's `AdminAuditLog` write — mirrors
   * `DeleteCategoryService`'s exact ordering. */
  delete(tx: Prisma.TransactionClient, id: string): Promise<AdminRole> {
    return tx.adminRole.delete({ where: { id } });
  }

  /** `DeleteAdminRoleService`'s "in use" pre-check — mirrors
   * `DeleteCategoryService`'s own pre-check shape; Postgres's own
   * `onDelete: Restrict` on `AdminUser.roleId` is the backstop underneath
   * this friendly, earlier error. */
  countAdminUsersByRoleId(roleId: string): Promise<number> {
    return this.prisma.adminUser.count({ where: { roleId } });
  }

  /**
   * The base read `AdminLockoutGuardService.assertPermissionRemainsGranted`
   * evaluates every hypothetical against: every `ACTIVE` `AdminUser` plus
   * the permissions their CURRENT role grants, entirely unfiltered. This is
   * an internal tool with an expected admin count in the tens, not
   * thousands — one small, unfiltered read is correct and simple here, not
   * a performance concern (see that service's own header comment for the
   * full "read-then-write, not a serializable transaction" design note).
   */
  async listActiveAdminUsersWithEffectivePermissions(): Promise<
    ActiveAdminUserEffectivePermissionsRow[]
  > {
    const rows = await this.prisma.adminUser.findMany({
      where: { status: AdminUserStatus.ACTIVE },
      select: {
        id: true,
        roleId: true,
        role: { select: { permissions: true } },
      },
    });
    return rows.map((row) => ({
      adminUserId: row.id,
      roleId: row.roleId,
      permissions: row.role.permissions,
    }));
  }
}
