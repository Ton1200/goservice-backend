import { AdminUserStatus, Permission } from '@prisma/client';
import { AdminRolesRepository } from '../admin-roles.repository';
import { AdminLockoutGuardService } from './admin-lockout-guard.service';

describe('AdminLockoutGuardService', () => {
  function makeService(
    rows: { adminUserId: string; roleId: string; permissions: Permission[] }[],
  ) {
    const listActiveAdminUsersWithEffectivePermissions = jest
      .fn()
      .mockResolvedValue(rows);
    const adminRolesRepository = {
      listActiveAdminUsersWithEffectivePermissions,
    } as unknown as AdminRolesRepository;

    const service = new AdminLockoutGuardService(adminRolesRepository);
    return { service, listActiveAdminUsersWithEffectivePermissions };
  }

  describe('ROLE_PERMISSIONS_UPDATE', () => {
    it('rejects (WOULD_LOCK_OUT_ADMIN_MANAGEMENT) when editing the ONLY role holding ADMIN_USERS_MANAGE would remove it, leaving zero ACTIVE admins with the permission', async () => {
      const { service } = makeService([
        {
          adminUserId: 'admin-1',
          roleId: 'role-super-admin',
          permissions: [
            Permission.ADMIN_USERS_MANAGE,
            Permission.AUDIT_LOG_READ,
          ],
        },
      ]);

      await expect(
        service.assertPermissionRemainsGranted(Permission.ADMIN_USERS_MANAGE, {
          kind: 'ROLE_PERMISSIONS_UPDATE',
          roleId: 'role-super-admin',
          newPermissions: [Permission.AUDIT_LOG_READ],
        }),
      ).rejects.toMatchObject({ code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT' });
    });

    it('allows the edit when ANOTHER role still holds ADMIN_USERS_MANAGE for at least one ACTIVE admin', async () => {
      const { service } = makeService([
        {
          adminUserId: 'admin-1',
          roleId: 'role-super-admin',
          permissions: [Permission.ADMIN_USERS_MANAGE],
        },
        {
          adminUserId: 'admin-2',
          roleId: 'role-other-super-admin',
          permissions: [Permission.ADMIN_USERS_MANAGE],
        },
      ]);

      await expect(
        service.assertPermissionRemainsGranted(Permission.ADMIN_USERS_MANAGE, {
          kind: 'ROLE_PERMISSIONS_UPDATE',
          roleId: 'role-super-admin',
          newPermissions: [],
        }),
      ).resolves.toBeUndefined();
    });

    it('allows the edit when it does not actually remove the permission from any row (e.g. a DIFFERENT role is being edited)', async () => {
      const { service } = makeService([
        {
          adminUserId: 'admin-1',
          roleId: 'role-super-admin',
          permissions: [Permission.ADMIN_USERS_MANAGE],
        },
      ]);

      await expect(
        service.assertPermissionRemainsGranted(Permission.ADMIN_USERS_MANAGE, {
          kind: 'ROLE_PERMISSIONS_UPDATE',
          roleId: 'role-config-manager',
          newPermissions: [Permission.SERVICE_REQUESTS_READ],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('ADMIN_USER_UPDATE', () => {
    it('rejects when revoking the only ACTIVE admin who effectively holds ADMIN_USERS_MANAGE', async () => {
      const { service } = makeService([
        {
          adminUserId: 'admin-1',
          roleId: 'role-super-admin',
          permissions: [Permission.ADMIN_USERS_MANAGE],
        },
      ]);

      await expect(
        service.assertPermissionRemainsGranted(Permission.ADMIN_USERS_MANAGE, {
          kind: 'ADMIN_USER_UPDATE',
          adminUserId: 'admin-1',
          newStatus: AdminUserStatus.REVOKED,
          newPermissions: [Permission.ADMIN_USERS_MANAGE],
        }),
      ).rejects.toMatchObject({ code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT' });
    });

    it('rejects when moving the last such admin to a role without ADMIN_USERS_MANAGE, even while staying ACTIVE', async () => {
      const { service } = makeService([
        {
          adminUserId: 'admin-1',
          roleId: 'role-super-admin',
          permissions: [Permission.ADMIN_USERS_MANAGE],
        },
      ]);

      await expect(
        service.assertPermissionRemainsGranted(Permission.ADMIN_USERS_MANAGE, {
          kind: 'ADMIN_USER_UPDATE',
          adminUserId: 'admin-1',
          newStatus: AdminUserStatus.ACTIVE,
          newPermissions: [Permission.SERVICE_REQUESTS_READ],
        }),
      ).rejects.toMatchObject({ code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT' });
    });

    it('allows revoking one admin when ANOTHER ACTIVE admin still holds ADMIN_USERS_MANAGE', async () => {
      const { service } = makeService([
        {
          adminUserId: 'admin-1',
          roleId: 'role-super-admin',
          permissions: [Permission.ADMIN_USERS_MANAGE],
        },
        {
          adminUserId: 'admin-2',
          roleId: 'role-super-admin',
          permissions: [Permission.ADMIN_USERS_MANAGE],
        },
      ]);

      await expect(
        service.assertPermissionRemainsGranted(Permission.ADMIN_USERS_MANAGE, {
          kind: 'ADMIN_USER_UPDATE',
          adminUserId: 'admin-1',
          newStatus: AdminUserStatus.REVOKED,
          newPermissions: [Permission.ADMIN_USERS_MANAGE],
        }),
      ).resolves.toBeUndefined();
    });
  });
});
