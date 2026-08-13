import { Injectable } from '@nestjs/common';
import { AdminUserStatus, Permission } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AdminUserEffectivePermissions {
  status: AdminUserStatus;
  permissions: Permission[];
}

/**
 * The permission-lookup read path for `AdminRbacService`
 * (`services/admin-rbac.service.ts`). Physically starts from `AdminUser`
 * (an admin's permissions only make sense joined through the role they
 * currently hold), but the query only ever SELECTs `status` +
 * `role.permissions` — never any other `AdminUser` column — so this stays a
 * narrow, RBAC-scoped read, distinct from
 * `../admin-auth/admin-users.repository.ts`'s own (differently-shaped)
 * `AdminUser` read for login. Both live inside the same `PlatformAdminModule`
 * DI graph, so this isn't a cross-module data-ownership violation — see
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
}
