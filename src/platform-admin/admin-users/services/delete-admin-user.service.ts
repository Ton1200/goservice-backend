import { Injectable } from '@nestjs/common';
import { AdminUserStatus, Permission } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AdminLockoutGuardService } from '../../admin-rbac/services/admin-lockout-guard.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import {
  adminUserHasAuditHistory,
  adminUserNotFound,
  cannotDeleteOwnAccount,
} from '../errors/admin-user.errors';
import { DeleteAdminUserPayload } from '../models/delete-admin-user-payload.model';

/**
 * Orchestrates `deleteAdminUser` — a REAL, PERMANENT delete (unlike
 * `updateAdminUser({ status: REVOKED })`, which is reversible). Order:
 *   1. lookup (ADMIN_USER_NOT_FOUND)
 *   2. self-delete guard (CANNOT_DELETE_OWN_ACCOUNT) — cheap, a plain id
 *      comparison, checked before any further DB read. A distinct code from
 *      `cannotRevokeOwnAccount()` — deleting is more consequential than
 *      revoking (irreversible), so it gets its own message.
 *   3. audit-history pre-check (ADMIN_USER_HAS_AUDIT_HISTORY) —
 *      `AdminAuditLog.actorAdminUser` is `onDelete: Restrict`, so this is a
 *      real DB-level impossibility for any admin who has ever done anything
 *      in this panel, not just a business rule. Checked here, BEFORE the
 *      lockout guard's own extra read, as a friendly pre-check rather than
 *      letting a raw Postgres FK-violation surface (same "pre-check, then
 *      clear error" convention `DeleteCategoryService`/`DeleteAdminRoleService`
 *      already establish for their own `onDelete: Restrict`-backed
 *      constraints).
 *   4. self-lockout guard — ONLY when the target currently effectively
 *      holds `ADMIN_USERS_MANAGE` (`status === ACTIVE` and their role
 *      grants it). Modeled as an `ADMIN_USER_UPDATE` hypothetical with a
 *      non-ACTIVE `newStatus` — `AdminLockoutGuardService` already treats
 *      any non-ACTIVE hypothetical status as "no longer counts", which is
 *      exactly what a deletion means too — no guard-service change needed.
 *   5. `$transaction`: audit write (`ADMIN_USER_DELETED`, BEFORE the delete
 *      — same "capture a snapshot before the row disappears forever" order
 *      `DeleteUserAccountService`/`DeleteCategoryService` already use) +
 *      the actual delete.
 */
@Injectable()
export class DeleteAdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminUsersRepository: AdminUsersRepository,
    private readonly adminLockoutGuard: AdminLockoutGuardService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async deleteAdminUser(
    actorAdminUserId: string,
    id: string,
  ): Promise<DeleteAdminUserPayload> {
    const existing = await this.adminUsersRepository.findById(id);
    if (!existing) {
      throw adminUserNotFound(id);
    }

    if (id === actorAdminUserId) {
      throw cannotDeleteOwnAccount();
    }

    const auditHistoryCount = await this.auditLogRepository.countByActor(id);
    if (auditHistoryCount > 0) {
      throw adminUserHasAuditHistory();
    }

    const currentlyHoldsManage =
      existing.status === AdminUserStatus.ACTIVE &&
      existing.role.permissions.includes(Permission.ADMIN_USERS_MANAGE);

    if (currentlyHoldsManage) {
      await this.adminLockoutGuard.assertPermissionRemainsGranted(
        Permission.ADMIN_USERS_MANAGE,
        {
          kind: 'ADMIN_USER_UPDATE',
          adminUserId: id,
          newStatus: AdminUserStatus.REVOKED, // any non-ACTIVE value — a deletion is, for this guard's purposes, indistinguishable from "no longer ACTIVE".
          newPermissions: [],
        },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.auditLogRepository.write(tx, {
        actorAdminUserId,
        action: 'ADMIN_USER_DELETED',
        targetType: 'AdminUser',
        targetKey: id,
        metadata: { email: existing.email, roleName: existing.role.name },
      });
      await this.adminUsersRepository.delete(tx, id);
    });

    return { success: true };
  }
}
