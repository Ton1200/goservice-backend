import { Injectable } from '@nestjs/common';
import { AdminUserStatus, Permission } from '@prisma/client';
import {
  ActiveAdminUserEffectivePermissionsRow,
  AdminRolesRepository,
} from '../admin-roles.repository';
import { wouldLockOutAdminManagement } from '../errors/admin-lockout.errors';

/**
 * The two ways a proposed write could reduce who effectively holds a given
 * `Permission`, evaluated by `assertPermissionRemainsGranted` below —
 * editing a ROLE's permission set (`updateAdminRolePermissions`), or editing
 * one ADMIN's status/role (`updateAdminUser`).
 */
export type LockoutHypothetical =
  | {
      kind: 'ROLE_PERMISSIONS_UPDATE';
      roleId: string;
      newPermissions: Permission[];
    }
  | {
      kind: 'ADMIN_USER_UPDATE';
      adminUserId: string;
      newStatus: AdminUserStatus;
      newPermissions: Permission[];
    };

/**
 * Self-lockout guard — genuinely new territory in this codebase, no prior
 * precedent for "prevent a change that would leave nobody able to manage
 * admins at all" exists anywhere else here. Before applying any change that
 * could REDUCE who holds `permission` (in practice, always
 * `Permission.ADMIN_USERS_MANAGE` — this feature's own guard), callers must
 * call `assertPermissionRemainsGranted` and let it throw
 * `WOULD_LOCK_OUT_ADMIN_MANAGEMENT` if the change would leave zero `ACTIVE`
 * `AdminUser`s holding that permission anywhere in the system.
 *
 * Deliberately ONE shared service evaluating a single unfiltered read
 * (`AdminRolesRepository.listActiveAdminUsersWithEffectivePermissions()`) in
 * memory against a discriminated-union "hypothetical", rather than two
 * separate parametrized SQL queries (one for "editing a role", one for
 * "editing an admin") — simpler, and more obviously correct: every row's
 * post-edit effective permission set is computed the exact same way
 * regardless of which kind of edit triggered the check.
 *
 * ACCEPTED LIMITATION, documented explicitly (do not attempt to build
 * stronger transaction-isolation machinery for this): this is a
 * "read-then-write" check, NOT a serializable transaction spanning the
 * read — the exact same class of guard `DeleteCategoryService`'s "in use"
 * pre-check already uses throughout this codebase. Two concurrent edits
 * against a system with EXACTLY two remaining holders of
 * `ADMIN_USERS_MANAGE` could, in theory, both pass this check independently
 * and still jointly cause the lockout this guard exists to prevent. This is
 * an accepted trade-off for an internal tool with a low-traffic, human
 * operator — not a gap to close with heavier machinery.
 */
@Injectable()
export class AdminLockoutGuardService {
  constructor(private readonly adminRolesRepository: AdminRolesRepository) {}

  async assertPermissionRemainsGranted(
    permission: Permission,
    hypothetical: LockoutHypothetical,
  ): Promise<void> {
    const rows =
      await this.adminRolesRepository.listActiveAdminUsersWithEffectivePermissions();

    const stillGranted = rows.some((row) => {
      const effectivePermissions = this.resolveHypotheticalPermissions(
        row,
        hypothetical,
      );
      return (
        effectivePermissions !== null &&
        effectivePermissions.includes(permission)
      );
    });

    if (!stillGranted) {
      throw wouldLockOutAdminManagement(permission);
    }
  }

  /**
   * Returns the permission set `row` would effectively hold AFTER
   * `hypothetical` is applied, or `null` if `row` should be excluded
   * entirely from "still holds it" consideration (only possible for
   * `ADMIN_USER_UPDATE`, when the hypothetical status is no longer
   * `ACTIVE`). Every other row (not the target of this specific
   * hypothetical) passes through with its current, unchanged permissions.
   */
  private resolveHypotheticalPermissions(
    row: ActiveAdminUserEffectivePermissionsRow,
    hypothetical: LockoutHypothetical,
  ): Permission[] | null {
    if (hypothetical.kind === 'ROLE_PERMISSIONS_UPDATE') {
      return row.roleId === hypothetical.roleId
        ? hypothetical.newPermissions
        : row.permissions;
    }

    // ADMIN_USER_UPDATE
    if (row.adminUserId !== hypothetical.adminUserId) {
      return row.permissions;
    }
    if (hypothetical.newStatus !== AdminUserStatus.ACTIVE) {
      // No longer ACTIVE post-edit — never counts toward "still granted",
      // regardless of which permissions its role would otherwise carry.
      return null;
    }
    return hypothetical.newPermissions;
  }
}
