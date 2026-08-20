import { Permission } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AdminLockoutGuardService } from '../../admin-rbac/services/admin-lockout-guard.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { UpdateAdminRolePermissionsService } from './update-admin-role-permissions.service';

describe('UpdateAdminRolePermissionsService', () => {
  const existing = {
    id: 'role-1',
    name: 'SUPER_ADMIN',
    permissions: [Permission.ADMIN_USERS_MANAGE, Permission.AUDIT_LOG_READ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: { existing?: unknown }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findById = jest
      .fn()
      .mockResolvedValue(
        overrides?.existing === undefined ? existing : overrides.existing,
      );
    const updatePermissions = jest
      .fn()
      .mockImplementation(
        (_tx: unknown, id: string, permissions: Permission[]) =>
          Promise.resolve({ ...existing, id, permissions }),
      );
    const adminRolesRepository = {
      findById,
      updatePermissions,
    } as unknown as AdminRolesRepository;

    const assertPermissionRemainsGranted = jest
      .fn()
      .mockResolvedValue(undefined);
    const adminLockoutGuard = {
      assertPermissionRemainsGranted,
    } as unknown as AdminLockoutGuardService;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new UpdateAdminRolePermissionsService(
      prisma,
      adminRolesRepository,
      adminLockoutGuard,
      auditLogRepository,
    );

    return {
      service,
      findById,
      updatePermissions,
      assertPermissionRemainsGranted,
      write,
    };
  }

  it('throws ADMIN_ROLE_NOT_FOUND when the id does not resolve to a real role', async () => {
    const { service } = makeService({ existing: null });

    await expect(
      service.updateAdminRolePermissions('admin-1', 'missing', []),
    ).rejects.toMatchObject({ code: 'ADMIN_ROLE_NOT_FOUND' });
  });

  it('is a no-op (no write, no audit, no lockout check) when the submitted permission set is identical (order-independent)', async () => {
    const {
      service,
      updatePermissions,
      assertPermissionRemainsGranted,
      write,
    } = makeService();

    await service.updateAdminRolePermissions('admin-1', existing.id, [
      Permission.AUDIT_LOG_READ,
      Permission.ADMIN_USERS_MANAGE,
    ]);

    expect(updatePermissions).not.toHaveBeenCalled();
    expect(assertPermissionRemainsGranted).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('does NOT call the lockout guard when the edit does not remove ADMIN_USERS_MANAGE', async () => {
    const { service, updatePermissions, assertPermissionRemainsGranted } =
      makeService();

    await service.updateAdminRolePermissions('admin-1', existing.id, [
      Permission.ADMIN_USERS_MANAGE,
      Permission.SERVICE_REQUESTS_READ,
    ]);

    expect(assertPermissionRemainsGranted).not.toHaveBeenCalled();
    expect(updatePermissions).toHaveBeenCalled();
  });

  it('calls the lockout guard when the edit WOULD remove ADMIN_USERS_MANAGE from a role that currently has it, and propagates its rejection without writing', async () => {
    const { service, updatePermissions, assertPermissionRemainsGranted } =
      makeService();
    assertPermissionRemainsGranted.mockRejectedValue(
      Object.assign(new Error('locked out'), {
        code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT',
      }),
    );

    await expect(
      service.updateAdminRolePermissions('admin-1', existing.id, [
        Permission.AUDIT_LOG_READ,
      ]),
    ).rejects.toMatchObject({ code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT' });

    expect(assertPermissionRemainsGranted).toHaveBeenCalledWith(
      Permission.ADMIN_USERS_MANAGE,
      {
        kind: 'ROLE_PERMISSIONS_UPDATE',
        roleId: existing.id,
        newPermissions: [Permission.AUDIT_LOG_READ],
      },
    );
    expect(updatePermissions).not.toHaveBeenCalled();
  });

  it('applies the edit and writes an ADMIN_ROLE_PERMISSIONS_UPDATED AdminAuditLog row when the lockout guard passes', async () => {
    const { service, updatePermissions, write } = makeService();

    const result = await service.updateAdminRolePermissions(
      'admin-1',
      existing.id,
      [Permission.AUDIT_LOG_READ],
    );

    expect(updatePermissions).toHaveBeenCalledWith(
      expect.anything(),
      existing.id,
      [Permission.AUDIT_LOG_READ],
    );
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'ADMIN_ROLE_PERMISSIONS_UPDATED',
        targetType: 'AdminRole',
        targetKey: existing.id,
      }),
    );
    expect(result.permissions).toEqual([Permission.AUDIT_LOG_READ]);
  });
});
