import { AdminUserStatus, Permission } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AdminLockoutGuardService } from '../../admin-rbac/services/admin-lockout-guard.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { UpdateAdminUserService } from './update-admin-user.service';

describe('UpdateAdminUserService', () => {
  const superAdminRole = {
    id: 'role-super-admin',
    name: 'SUPER_ADMIN',
    permissions: [Permission.ADMIN_USERS_MANAGE, Permission.AUDIT_LOG_READ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const supportRole = {
    id: 'role-support',
    name: 'SUPPORT_VIEWER',
    permissions: [Permission.AUDIT_LOG_READ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeExisting(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Admin One',
      status: AdminUserStatus.ACTIVE,
      roleId: superAdminRole.id,
      role: superAdminRole,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function makeService(options: {
    existing?: unknown;
    role?: unknown;
    lockoutRejects?: boolean;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findById = jest
      .fn()
      .mockResolvedValue(
        options.existing === undefined ? makeExisting() : options.existing,
      );
    const updateForAdmin = jest
      .fn()
      .mockImplementation(
        (_tx: unknown, id: string, data: Record<string, unknown>) =>
          Promise.resolve({ ...makeExisting(), id, ...data }),
      );
    const adminUsersRepository = {
      findById,
      updateForAdmin,
    } as unknown as AdminUsersRepository;

    const findRoleById = jest
      .fn()
      .mockResolvedValue(
        options.role === undefined ? supportRole : options.role,
      );
    const adminRolesRepository = {
      findById: findRoleById,
    } as unknown as AdminRolesRepository;

    const assertPermissionRemainsGranted = jest.fn().mockImplementation(() =>
      options.lockoutRejects
        ? Promise.reject(
            Object.assign(new Error('locked out'), {
              code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT',
            }),
          )
        : Promise.resolve(undefined),
    );
    const adminLockoutGuard = {
      assertPermissionRemainsGranted,
    } as unknown as AdminLockoutGuardService;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new UpdateAdminUserService(
      prisma,
      adminUsersRepository,
      adminRolesRepository,
      adminLockoutGuard,
      auditLogRepository,
    );

    return {
      service,
      findById,
      updateForAdmin,
      findRoleById,
      assertPermissionRemainsGranted,
      write,
    };
  }

  it('throws ADMIN_USER_NOT_FOUND when the id does not resolve to a real admin', async () => {
    const { service } = makeService({ existing: null });

    await expect(
      service.updateAdminUser('actor-1', 'missing', { displayName: 'X' }),
    ).rejects.toMatchObject({ code: 'ADMIN_USER_NOT_FOUND' });
  });

  it('throws ADMIN_USER_INVALID_STATUS_TRANSITION when status: INVITED is submitted', async () => {
    const { service, updateForAdmin } = makeService({});

    await expect(
      service.updateAdminUser('actor-1', 'admin-1', {
        status: AdminUserStatus.INVITED,
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_USER_INVALID_STATUS_TRANSITION' });
    expect(updateForAdmin).not.toHaveBeenCalled();
  });

  it('is a no-op (no write, no audit) when nothing in the input differs from the current state', async () => {
    const { service, updateForAdmin, write } = makeService({});

    await service.updateAdminUser('actor-1', 'admin-1', {
      displayName: 'Admin One',
    });

    expect(updateForAdmin).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  describe('self-revocation guard', () => {
    it('rejects (CANNOT_REVOKE_OWN_ACCOUNT) when an admin tries to revoke their OWN account, checked BEFORE any lockout-guard read', async () => {
      const { service, updateForAdmin, assertPermissionRemainsGranted } =
        makeService({});

      await expect(
        service.updateAdminUser('admin-1', 'admin-1', {
          status: AdminUserStatus.REVOKED,
        }),
      ).rejects.toMatchObject({ code: 'CANNOT_REVOKE_OWN_ACCOUNT' });
      expect(updateForAdmin).not.toHaveBeenCalled();
      expect(assertPermissionRemainsGranted).not.toHaveBeenCalled();
    });

    it('allows revoking a DIFFERENT admin (actor id differs from target id)', async () => {
      const { service, updateForAdmin } = makeService({
        existing: makeExisting({ role: supportRole, roleId: supportRole.id }),
      });

      await service.updateAdminUser('actor-1', 'admin-1', {
        status: AdminUserStatus.REVOKED,
      });

      expect(updateForAdmin).toHaveBeenCalled();
    });
  });

  describe('self-lockout guard short-circuit', () => {
    it('does NOT call the lockout guard when the edit does not touch a permission-relevant field', async () => {
      const { service, assertPermissionRemainsGranted, updateForAdmin } =
        makeService({});

      await service.updateAdminUser('actor-1', 'admin-1', {
        displayName: 'Updated Name',
      });

      expect(assertPermissionRemainsGranted).not.toHaveBeenCalled();
      expect(updateForAdmin).toHaveBeenCalled();
    });

    it('does NOT call the lockout guard when the admin does not currently hold ADMIN_USERS_MANAGE', async () => {
      const { service, assertPermissionRemainsGranted, updateForAdmin } =
        makeService({
          existing: makeExisting({ role: supportRole, roleId: supportRole.id }),
        });

      await service.updateAdminUser('actor-1', 'admin-1', {
        status: AdminUserStatus.REVOKED,
      });

      expect(assertPermissionRemainsGranted).not.toHaveBeenCalled();
      expect(updateForAdmin).toHaveBeenCalled();
    });

    it('calls the lockout guard when re-assigning an admin who currently holds ADMIN_USERS_MANAGE to a role that lacks it, and propagates a rejection without writing', async () => {
      const { service, assertPermissionRemainsGranted, updateForAdmin } =
        makeService({ lockoutRejects: true });

      await expect(
        service.updateAdminUser('actor-1', 'admin-1', {
          roleId: supportRole.id,
        }),
      ).rejects.toMatchObject({ code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT' });

      expect(assertPermissionRemainsGranted).toHaveBeenCalledWith(
        Permission.ADMIN_USERS_MANAGE,
        {
          kind: 'ADMIN_USER_UPDATE',
          adminUserId: 'admin-1',
          newStatus: AdminUserStatus.ACTIVE,
          newPermissions: supportRole.permissions,
        },
      );
      expect(updateForAdmin).not.toHaveBeenCalled();
    });

    it('calls the lockout guard when revoking an admin who currently holds ADMIN_USERS_MANAGE, and applies the write when the guard passes', async () => {
      const { service, assertPermissionRemainsGranted, updateForAdmin, write } =
        makeService({});

      await service.updateAdminUser('actor-2', 'admin-1', {
        status: AdminUserStatus.REVOKED,
      });

      expect(assertPermissionRemainsGranted).toHaveBeenCalledWith(
        Permission.ADMIN_USERS_MANAGE,
        {
          kind: 'ADMIN_USER_UPDATE',
          adminUserId: 'admin-1',
          newStatus: AdminUserStatus.REVOKED,
          newPermissions: superAdminRole.permissions,
        },
      );
      expect(updateForAdmin).toHaveBeenCalled();
      expect(write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'ADMIN_USER_UPDATED',
          targetType: 'AdminUser',
          targetKey: 'admin-1',
        }),
      );
    });
  });

  it('throws ADMIN_ROLE_NOT_FOUND when roleId does not resolve to a real role', async () => {
    const { service, updateForAdmin } = makeService({ role: null });

    await expect(
      service.updateAdminUser('actor-1', 'admin-1', { roleId: 'missing' }),
    ).rejects.toMatchObject({ code: 'ADMIN_ROLE_NOT_FOUND' });
    expect(updateForAdmin).not.toHaveBeenCalled();
  });
});
