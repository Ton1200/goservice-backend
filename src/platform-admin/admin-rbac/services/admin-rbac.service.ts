import { Injectable } from '@nestjs/common';
import { AdminUserStatus, Permission } from '@prisma/client';
import { AdminRolesRepository } from '../admin-roles.repository';

/**
 * The one place `AdminPermissionsGuard` asks "does this admin currently
 * hold permission X?" — deliberately RE-QUERIES `AdminRolesRepository` on
 * every call rather than trusting anything cached at `adminLogin` time, so
 * a revoked/downgraded admin's in-flight session loses write access
 * immediately (see the platform-admin plan's "The `FeatureFlagPort`
 * cross-boundary read" section for the explicit rationale). No snapshot,
 * no request-scoped cache, no TTL.
 */
@Injectable()
export class AdminRbacService {
  constructor(private readonly adminRolesRepository: AdminRolesRepository) {}

  async hasAllPermissions(
    adminUserId: string,
    required: Permission[],
  ): Promise<boolean> {
    if (required.length === 0) {
      return true;
    }
    const granted = await this.getGrantedPermissions(adminUserId);
    return required.every((permission) => granted.includes(permission));
  }

  async hasPermission(
    adminUserId: string,
    permission: Permission,
  ): Promise<boolean> {
    return this.hasAllPermissions(adminUserId, [permission]);
  }

  private async getGrantedPermissions(
    adminUserId: string,
  ): Promise<Permission[]> {
    const result =
      await this.adminRolesRepository.findEffectivePermissions(adminUserId);
    // A REVOKED (or otherwise not-ACTIVE) admin holds zero effective
    // permissions, regardless of what their role would otherwise grant —
    // this is what makes revocation immediate rather than eventual.
    if (!result || result.status !== AdminUserStatus.ACTIVE) {
      return [];
    }
    return result.permissions;
  }
}
