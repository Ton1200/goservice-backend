import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { isSeededAdminRoleName } from '../../admin-rbac/seeded-admin-role-names.constant';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import {
  adminRoleInUse,
  adminRoleIsSystemRole,
  adminRoleNotFound,
} from '../errors/admin-role.errors';
import { DeleteAdminRolePayload } from '../models/delete-admin-role-payload.model';

/**
 * Orchestrates `deleteAdminRole` — lookup → reject a seeded system role by
 * NAME (`SEEDED_ADMIN_ROLE_NAMES`) → "in use" pre-check
 * (`countAdminUsersByRoleId`) → `$transaction` audit-write-BEFORE-delete,
 * mirroring `DeleteCategoryService`'s exact shape.
 *
 * NO lockout-guard call here, deliberately: the "in use" pre-check above
 * already guarantees zero `AdminUser`s reference this role, so deleting it
 * can never change any admin's effective permissions.
 */
@Injectable()
export class DeleteAdminRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminRolesRepository: AdminRolesRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async deleteAdminRole(
    adminUserId: string,
    id: string,
  ): Promise<DeleteAdminRolePayload> {
    const existing = await this.adminRolesRepository.findById(id);
    if (!existing) {
      throw adminRoleNotFound(id);
    }

    if (isSeededAdminRoleName(existing.name)) {
      throw adminRoleIsSystemRole(existing.name);
    }

    const inUseCount =
      await this.adminRolesRepository.countAdminUsersByRoleId(id);
    if (inUseCount > 0) {
      throw adminRoleInUse(inUseCount);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'ADMIN_ROLE_DELETED',
        targetType: 'AdminRole',
        targetKey: id,
        metadata: { name: existing.name, permissions: existing.permissions },
      });

      await this.adminRolesRepository.delete(tx, id);
    });

    return { success: true };
  }
}
