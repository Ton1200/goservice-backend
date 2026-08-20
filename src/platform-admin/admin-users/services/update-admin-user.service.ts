import { Injectable } from '@nestjs/common';
import { AdminUserStatus, Permission, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AdminLockoutGuardService } from '../../admin-rbac/services/admin-lockout-guard.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { adminRoleNotFound } from '../../admin-roles/errors/admin-role.errors';
import {
  adminUserInvalidStatusTransition,
  adminUserNotFound,
  cannotRevokeOwnAccount,
} from '../errors/admin-user.errors';
import { UpdateAdminUserInput } from '../models/update-admin-user.input';
import { AdminUserModel } from '../models/admin-user.model';
import { toAdminUserModel } from '../models/to-admin-user-model.util';

/**
 * Orchestrates `updateAdminUser` — a PARTIAL PATCH (only fields actually
 * present in `input` are considered), same convention
 * `UpdateUserAccountService` establishes. Order, per this feature's own
 * safety-critical design:
 *   1. lookup (ADMIN_USER_NOT_FOUND)
 *   2. reject `status: INVITED` as an explicit target
 *      (ADMIN_USER_INVALID_STATUS_TRANSITION) — that status is only ever
 *      reachable via the invite flow.
 *   3. self-revocation guard (CANNOT_REVOKE_OWN_ACCOUNT) — cheap, a plain id
 *      comparison, checked BEFORE the lockout guard's extra DB read.
 *   4. build the partial patch (`changedFields`/`changes`, same shape as
 *      `UpdateUserAccountService`); if `roleId` changes, validate the
 *      target role exists (ADMIN_ROLE_NOT_FOUND).
 *   5. no-op short-circuit if nothing actually changed — no write, no audit.
 *   6. self-lockout guard — ONLY when this edit would actually remove
 *      `ADMIN_USERS_MANAGE` from an admin who currently effectively holds it
 *      (`existing.status === ACTIVE && existing.role.permissions` includes
 *      it) AND the resolved-after-patch state would no longer hold it.
 *   7. `$transaction`: `updateForAdmin` + audit `ADMIN_USER_UPDATED`.
 */
@Injectable()
export class UpdateAdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminUsersRepository: AdminUsersRepository,
    private readonly adminRolesRepository: AdminRolesRepository,
    private readonly adminLockoutGuard: AdminLockoutGuardService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async updateAdminUser(
    actorAdminUserId: string,
    id: string,
    input: UpdateAdminUserInput,
  ): Promise<AdminUserModel> {
    const existing = await this.adminUsersRepository.findById(id);
    if (!existing) {
      throw adminUserNotFound(id);
    }

    if (input.status === AdminUserStatus.INVITED) {
      throw adminUserInvalidStatusTransition(input.status);
    }

    // Self-revocation guard — checked BEFORE the lockout guard (cheaper: no
    // extra DB read). Independent of it: this rejects self-revocation even
    // when another ACTIVE admin still holds ADMIN_USERS_MANAGE and the
    // lockout guard would otherwise allow the change.
    if (
      input.status !== undefined &&
      input.status !== existing.status &&
      input.status === AdminUserStatus.REVOKED &&
      id === actorAdminUserId
    ) {
      throw cannotRevokeOwnAccount();
    }

    const data: Prisma.AdminUserUpdateInput = {};
    const changedFields: string[] = [];
    const changes: Record<string, { old: unknown; new: unknown }> = {};

    const recordChange = (
      field: string,
      oldValue: unknown,
      newValue: unknown,
    ): void => {
      changedFields.push(field);
      changes[field] = { old: oldValue, new: newValue };
    };

    if (
      input.displayName !== undefined &&
      input.displayName !== existing.displayName
    ) {
      data.displayName = input.displayName;
      recordChange('displayName', existing.displayName, input.displayName);
    }

    // Tracks the role this admin would effectively hold AFTER the patch —
    // starts as the CURRENT role, replaced below only if roleId actually
    // changes. Used by the lockout-guard short-circuit further down.
    let effectiveRole = existing.role;
    if (input.roleId !== undefined && input.roleId !== existing.roleId) {
      const targetRole = await this.adminRolesRepository.findById(input.roleId);
      if (!targetRole) {
        throw adminRoleNotFound(input.roleId);
      }
      data.role = { connect: { id: input.roleId } };
      recordChange('roleId', existing.roleId, input.roleId);
      effectiveRole = targetRole;
    }

    let effectiveStatus = existing.status;
    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status;
      recordChange('status', existing.status, input.status);
      effectiveStatus = input.status;
    }

    if (changedFields.length === 0) {
      // Nothing actually differs from the current state — a legitimate
      // no-op. No write, no audit log entry.
      return toAdminUserModel(existing);
    }

    // Self-lockout guard — ONLY when this edit would actually remove
    // ADMIN_USERS_MANAGE from an admin who currently effectively holds it.
    const currentlyHoldsManage =
      existing.status === AdminUserStatus.ACTIVE &&
      existing.role.permissions.includes(Permission.ADMIN_USERS_MANAGE);
    const willStillHoldManage =
      effectiveStatus === AdminUserStatus.ACTIVE &&
      effectiveRole.permissions.includes(Permission.ADMIN_USERS_MANAGE);

    if (currentlyHoldsManage && !willStillHoldManage) {
      await this.adminLockoutGuard.assertPermissionRemainsGranted(
        Permission.ADMIN_USERS_MANAGE,
        {
          kind: 'ADMIN_USER_UPDATE',
          adminUserId: id,
          newStatus: effectiveStatus,
          newPermissions: effectiveRole.permissions,
        },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.adminUsersRepository.updateForAdmin(
        tx,
        id,
        data,
      );

      await this.auditLogRepository.write(tx, {
        actorAdminUserId,
        action: 'ADMIN_USER_UPDATED',
        targetType: 'AdminUser',
        targetKey: id,
        metadata: { changedFields, changes } as Prisma.InputJsonValue,
      });

      return toAdminUserModel(updated);
    });
  }
}
