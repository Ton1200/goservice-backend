import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AdminLockoutGuardService } from '../../admin-rbac/services/admin-lockout-guard.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { DeleteAdminUserService } from './delete-admin-user.service';

describe('DeleteAdminUserService', () => {
  const existing = {
    id: 'admin-1',
    email: 'target@example.com',
    displayName: 'Target Admin',
    status: 'ACTIVE',
    roleId: 'role-1',
    role: {
      id: 'role-1',
      name: 'CONFIG_MANAGER',
      permissions: ['FEATURE_FLAGS_READ'],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: {
    findByIdResult?: typeof existing | null;
    auditCount?: number;
  }) {
    const findById = jest
      .fn()
      .mockResolvedValue(
        overrides?.findByIdResult === undefined
          ? existing
          : overrides.findByIdResult,
      );
    const deleteFn = jest.fn().mockResolvedValue(existing);
    const adminUsersRepository = {
      findById,
      delete: deleteFn,
    } as unknown as AdminUsersRepository;

    const countByActor = jest
      .fn()
      .mockResolvedValue(overrides?.auditCount ?? 0);
    const write = jest.fn().mockResolvedValue(undefined);
    const auditLogRepository = {
      countByActor,
      write,
    } as unknown as AuditLogRepository;

    const assertPermissionRemainsGranted = jest
      .fn()
      .mockResolvedValue(undefined);
    const adminLockoutGuard = {
      assertPermissionRemainsGranted,
    } as unknown as AdminLockoutGuardService;

    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
    } as never;

    const service = new DeleteAdminUserService(
      prisma,
      adminUsersRepository,
      adminLockoutGuard,
      auditLogRepository,
    );

    return {
      service,
      findById,
      deleteFn,
      countByActor,
      write,
      assertPermissionRemainsGranted,
    };
  }

  it('throws ADMIN_USER_NOT_FOUND for a nonexistent id', async () => {
    const { service } = makeService({ findByIdResult: null });

    await expect(
      service.deleteAdminUser('actor-1', 'nonexistent'),
    ).rejects.toMatchObject({ code: 'ADMIN_USER_NOT_FOUND' });
  });

  it('throws CANNOT_DELETE_OWN_ACCOUNT before any audit/lockout check', async () => {
    const { service, countByActor, assertPermissionRemainsGranted } =
      makeService();

    await expect(
      service.deleteAdminUser('admin-1', 'admin-1'),
    ).rejects.toMatchObject({ code: 'CANNOT_DELETE_OWN_ACCOUNT' });
    expect(countByActor).not.toHaveBeenCalled();
    expect(assertPermissionRemainsGranted).not.toHaveBeenCalled();
  });

  it('throws ADMIN_USER_HAS_AUDIT_HISTORY when the target has authored any audit row, without deleting', async () => {
    const { service, deleteFn } = makeService({ auditCount: 3 });

    await expect(
      service.deleteAdminUser('actor-1', 'admin-1'),
    ).rejects.toMatchObject({ code: 'ADMIN_USER_HAS_AUDIT_HISTORY' });
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('invokes the lockout guard only when the target currently holds ADMIN_USERS_MANAGE while ACTIVE', async () => {
    const { service, assertPermissionRemainsGranted } = makeService();

    await service.deleteAdminUser('actor-1', 'admin-1');

    expect(assertPermissionRemainsGranted).not.toHaveBeenCalled(); // CONFIG_MANAGER fixture doesn't hold ADMIN_USERS_MANAGE
  });

  it('calls the lockout guard when the target ACTIVE admin holds ADMIN_USERS_MANAGE, and propagates its rejection', async () => {
    const { service, assertPermissionRemainsGranted, deleteFn } = makeService({
      findByIdResult: {
        ...existing,
        role: { ...existing.role, permissions: ['ADMIN_USERS_MANAGE'] },
      },
    });
    assertPermissionRemainsGranted.mockRejectedValueOnce(
      Object.assign(new Error('would lock out'), {
        code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT',
      }),
    );

    await expect(
      service.deleteAdminUser('actor-1', 'admin-1'),
    ).rejects.toMatchObject({ code: 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT' });
    expect(assertPermissionRemainsGranted).toHaveBeenCalledWith(
      'ADMIN_USERS_MANAGE',
      expect.objectContaining({
        kind: 'ADMIN_USER_UPDATE',
        adminUserId: 'admin-1',
      }),
    );
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('happy path: writes ADMIN_USER_DELETED audit entry before deleting, returns success', async () => {
    const { service, write, deleteFn } = makeService();

    const result = await service.deleteAdminUser('actor-1', 'admin-1');

    expect(result).toEqual({ success: true });
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorAdminUserId: 'actor-1',
        action: 'ADMIN_USER_DELETED',
        targetType: 'AdminUser',
        targetKey: 'admin-1',
      }),
    );
    expect(deleteFn).toHaveBeenCalledWith(expect.anything(), 'admin-1');
    const writeOrder = write.mock.invocationCallOrder[0];
    const deleteOrder = deleteFn.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(deleteOrder);
  });
});
