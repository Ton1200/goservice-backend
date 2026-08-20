import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { adminRoleNameTaken } from '../errors/admin-role.errors';
import { CreateAdminRoleInput } from '../models/create-admin-role.input';
import { AdminRoleModel } from '../models/admin-role.model';
import { toAdminRoleModel } from '../models/to-admin-role-model.util';

/**
 * Orchestrates `createAdminRole`. This service owns the transaction
 * boundary (injects `PrismaService` directly) for the same reason
 * `CreateCategoryService` does — it spans two tables owned by two different
 * repositories (`AdminRolesRepository`, `AuditLogRepository`).
 *
 * NO lockout-guard call here, deliberately: a brand-new role can only ADD
 * capability to the system (nobody is assigned to it yet — `AdminUser.roleId`
 * always references an EXISTING role at creation time), it can never REDUCE
 * who holds a permission. `AdminLockoutGuardService` is only ever relevant to
 * an EDIT that could take a permission away from someone who currently has
 * it.
 */
@Injectable()
export class CreateAdminRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminRolesRepository: AdminRolesRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async createAdminRole(
    adminUserId: string,
    input: CreateAdminRoleInput,
  ): Promise<AdminRoleModel> {
    const name = input.name.trim();
    const existing = await this.adminRolesRepository.findByName(name);
    if (existing) {
      throw adminRoleNameTaken(name);
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await this.adminRolesRepository.create(tx, {
        name,
        permissions: input.permissions,
      });

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'ADMIN_ROLE_CREATED',
        targetType: 'AdminRole',
        targetKey: created.id,
        metadata: {
          name: created.name,
          permissions: created.permissions,
        },
      });

      return toAdminRoleModel(created);
    });
  }
}
