import { PrismaService } from '../../../prisma/prisma.service';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { DeleteAdminRoleService } from './delete-admin-role.service';

describe('DeleteAdminRoleService', () => {
  const customRole = {
    id: 'role-1',
    name: 'SUPPORT_L2',
    permissions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: {
    existing?: unknown;
    inUseCount?: number;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findById = jest
      .fn()
      .mockResolvedValue(
        overrides?.existing === undefined ? customRole : overrides.existing,
      );
    const countAdminUsersByRoleId = jest
      .fn()
      .mockResolvedValue(overrides?.inUseCount ?? 0);
    const deleteFn = jest.fn().mockResolvedValue(customRole);
    const adminRolesRepository = {
      findById,
      countAdminUsersByRoleId,
      delete: deleteFn,
    } as unknown as AdminRolesRepository;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new DeleteAdminRoleService(
      prisma,
      adminRolesRepository,
      auditLogRepository,
    );

    return { service, findById, deleteFn, write };
  }

  it('deletes an unused, non-seeded role and writes an AdminAuditLog row', async () => {
    const { service, deleteFn, write } = makeService();

    const result = await service.deleteAdminRole('admin-1', customRole.id);

    expect(deleteFn).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      customRole.id,
    );
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'ADMIN_ROLE_DELETED',
        targetType: 'AdminRole',
        targetKey: customRole.id,
      }),
    );
    expect(result).toEqual({ success: true });
  });

  it('throws ADMIN_ROLE_NOT_FOUND when the id does not resolve to a real role', async () => {
    const { service } = makeService({ existing: null });

    await expect(
      service.deleteAdminRole('admin-1', 'missing'),
    ).rejects.toMatchObject({ code: 'ADMIN_ROLE_NOT_FOUND' });
  });

  it('throws ADMIN_ROLE_IS_SYSTEM_ROLE for each of the 3 seeded role names, with no delete attempted', async () => {
    for (const name of ['SUPER_ADMIN', 'CONFIG_MANAGER', 'SUPPORT_VIEWER']) {
      const { service, deleteFn } = makeService({
        existing: { ...customRole, id: `role-${name}`, name },
      });

      await expect(
        service.deleteAdminRole('admin-1', `role-${name}`),
      ).rejects.toMatchObject({ code: 'ADMIN_ROLE_IS_SYSTEM_ROLE' });
      expect(deleteFn).not.toHaveBeenCalled();
    }
  });

  it('throws ADMIN_ROLE_IN_USE when at least one AdminUser still references this role, with no delete attempted', async () => {
    const { service, deleteFn } = makeService({ inUseCount: 2 });

    await expect(
      service.deleteAdminRole('admin-1', customRole.id),
    ).rejects.toMatchObject({ code: 'ADMIN_ROLE_IN_USE' });
    expect(deleteFn).not.toHaveBeenCalled();
  });
});
