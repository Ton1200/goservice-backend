import { Injectable } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AdminLockoutGuardService } from '../../admin-rbac/services/admin-lockout-guard.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { adminRoleNotFound } from '../errors/admin-role.errors';
import { AdminRoleModel } from '../models/admin-role.model';
import { toAdminRoleModel } from '../models/to-admin-role-model.util';

function samePermissionSet(a: Permission[], b: Permission[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((permission, index) => permission === sortedB[index]);
}

/**
 * Orchestrates `updateAdminRolePermissions` — FULL-STATE (`permissions`
 * always replaces the entire array, same convention `SetPlatformSettingInput`
 * already establishes for a checkbox-matrix-shaped input).
 *
 * DELIBERATELY NO name-based restriction here — unlike `DeleteAdminRoleService`,
 * this mutation applies to ALL 3 seeded roles too, `SUPER_ADMIN` included, by
 * explicit human decision: only a role's NAME is fixed/protected, never its
 * permission set. Do not add a `SEEDED_ADMIN_ROLE_NAMES` check to this
 * service.
 *
 * The self-lockout guard is called ONLY when this specific edit would
 * actually REMOVE `Permission.ADMIN_USERS_MANAGE` from a role that
 * currently has it — a short-circuit, not called on every edit.
 */
@Injectable()
export class UpdateAdminRolePermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminRolesRepository: AdminRolesRepository,
    private readonly adminLockoutGuard: AdminLockoutGuardService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async updateAdminRolePermissions(
    adminUserId: string,
    id: string,
    permissions: Permission[],
  ): Promise<AdminRoleModel> {
    const existing = await this.adminRolesRepository.findById(id);
    if (!existing) {
      throw adminRoleNotFound(id);
    }

    if (samePermissionSet(existing.permissions, permissions)) {
      // A true no-op — same convention as UpdateUserAccountService/
      // UpdateCategoryService: no write, no audit row.
      return toAdminRoleModel(existing);
    }

    const losesAdminUsersManage =
      existing.permissions.includes(Permission.ADMIN_USERS_MANAGE) &&
      !permissions.includes(Permission.ADMIN_USERS_MANAGE);

    if (losesAdminUsersManage) {
      await this.adminLockoutGuard.assertPermissionRemainsGranted(
        Permission.ADMIN_USERS_MANAGE,
        {
          kind: 'ROLE_PERMISSIONS_UPDATE',
          roleId: id,
          newPermissions: permissions,
        },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.adminRolesRepository.updatePermissions(
        tx,
        id,
        permissions,
      );

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'ADMIN_ROLE_PERMISSIONS_UPDATED',
        targetType: 'AdminRole',
        targetKey: id,
        metadata: {
          name: existing.name,
          oldPermissions: existing.permissions,
          newPermissions: permissions,
        },
      });

      return toAdminRoleModel(updated);
    });
  }
}
