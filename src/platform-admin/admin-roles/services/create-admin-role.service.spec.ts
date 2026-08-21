import { Permission } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { CreateAdminRoleService } from './create-admin-role.service';

describe('CreateAdminRoleService', () => {
  function makeService(existingRole?: unknown) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findByName = jest.fn().mockResolvedValue(existingRole ?? null);
    const created = {
      id: 'role-1',
      name: 'SUPPORT_L2',
      permissions: [Permission.SERVICE_REQUESTS_READ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const create = jest.fn().mockResolvedValue(created);
    const adminRolesRepository = {
      findByName,
      create,
    } as unknown as AdminRolesRepository;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new CreateAdminRoleService(
      prisma,
      adminRolesRepository,
      auditLogRepository,
    );

    return { service, findByName, create, write, created };
  }

  it('creates a new role and writes an ADMIN_ROLE_CREATED AdminAuditLog row', async () => {
    const { service, create, write, created } = makeService();

    const result = await service.createAdminRole('admin-1', {
      name: 'SUPPORT_L2',
      permissions: [Permission.SERVICE_REQUESTS_READ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      { name: 'SUPPORT_L2', permissions: [Permission.SERVICE_REQUESTS_READ] },
    );
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'ADMIN_ROLE_CREATED',
        targetType: 'AdminRole',
        targetKey: created.id,
      }),
    );
    expect(result.id).toBe(created.id);
    expect(result.name).toBe(created.name);
  });

  it('throws ADMIN_ROLE_NAME_TAKEN when a role with the same name already exists, with no write attempted', async () => {
    const { service, create } = makeService({
      id: 'existing',
      name: 'SUPPORT_L2',
    });

    await expect(
      service.createAdminRole('admin-1', {
        name: 'SUPPORT_L2',
        permissions: [],
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_ROLE_NAME_TAKEN' });
    expect(create).not.toHaveBeenCalled();
  });
});
