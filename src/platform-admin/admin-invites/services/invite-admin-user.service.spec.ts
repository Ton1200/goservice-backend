import { PrismaService } from '../../../prisma/prisma.service';
import { EnsureEmailDeliveryAvailableService } from '../../../email/services/ensure-email-delivery-available.service';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { IssueAdminInviteService } from './issue-admin-invite.service';
import { InviteAdminUserService } from './invite-admin-user.service';

describe('InviteAdminUserService', () => {
  const role = {
    id: 'role-1',
    name: 'SUPPORT_VIEWER',
    permissions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const created = {
    id: 'admin-new',
    email: 'new-admin@example.com',
    displayName: 'New Admin',
    status: 'INVITED',
    roleId: role.id,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(options?: {
    existingAdmin?: unknown;
    role?: unknown;
    ensureAvailableRejects?: boolean;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const ensureAvailable = jest.fn().mockImplementation(() =>
      options?.ensureAvailableRejects
        ? Promise.reject(
            Object.assign(new Error('disabled'), {
              code: 'EMAIL_DELIVERY_DISABLED',
            }),
          )
        : Promise.resolve(undefined),
    );
    const ensureEmailDeliveryAvailable = {
      ensureAvailable,
    } as unknown as EnsureEmailDeliveryAvailableService;

    const findByEmail = jest
      .fn()
      .mockResolvedValue(options?.existingAdmin ?? null);
    const createInvited = jest.fn().mockResolvedValue(created);
    const adminUsersRepository = {
      findByEmail,
      createInvited,
    } as unknown as AdminUsersRepository;

    const findRoleById = jest
      .fn()
      .mockResolvedValue(options?.role === undefined ? role : options.role);
    const adminRolesRepository = {
      findById: findRoleById,
    } as unknown as AdminRolesRepository;

    const issueForAdminUser = jest.fn().mockResolvedValue({ issued: true });
    const issueAdminInviteService = {
      issueForAdminUser,
    } as unknown as IssueAdminInviteService;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new InviteAdminUserService(
      prisma,
      ensureEmailDeliveryAvailable,
      adminUsersRepository,
      adminRolesRepository,
      issueAdminInviteService,
      auditLogRepository,
    );

    return {
      service,
      ensureAvailable,
      findByEmail,
      createInvited,
      findRoleById,
      issueForAdminUser,
      write,
    };
  }

  it('checks email delivery availability FIRST, before any other work', async () => {
    const { service, ensureAvailable, findByEmail } = makeService({
      ensureAvailableRejects: true,
    });

    await expect(
      service.inviteAdminUser('actor-1', {
        email: created.email,
        displayName: created.displayName,
        roleId: role.id,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_DISABLED' });
    expect(ensureAvailable).toHaveBeenCalled();
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('throws ADMIN_USER_EMAIL_TAKEN when the email already belongs to an AdminUser', async () => {
    const { service, createInvited } = makeService({
      existingAdmin: { id: 'existing' },
    });

    await expect(
      service.inviteAdminUser('actor-1', {
        email: created.email,
        displayName: created.displayName,
        roleId: role.id,
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_USER_EMAIL_TAKEN' });
    expect(createInvited).not.toHaveBeenCalled();
  });

  it('throws ADMIN_ROLE_NOT_FOUND when roleId does not resolve to a real role', async () => {
    const { service, createInvited } = makeService({ role: null });

    await expect(
      service.inviteAdminUser('actor-1', {
        email: created.email,
        displayName: created.displayName,
        roleId: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_ROLE_NOT_FOUND' });
    expect(createInvited).not.toHaveBeenCalled();
  });

  it('creates the INVITED AdminUser, issues the invite, and writes an ADMIN_USER_INVITED AdminAuditLog row', async () => {
    const { service, createInvited, issueForAdminUser, write } = makeService();

    const result = await service.inviteAdminUser('actor-1', {
      email: created.email,
      displayName: created.displayName,
      roleId: role.id,
    });

    expect(createInvited).toHaveBeenCalledWith({
      email: created.email,
      displayName: created.displayName,
      roleId: role.id,
    });
    expect(issueForAdminUser).toHaveBeenCalledWith(created.id, created.email);
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorAdminUserId: 'actor-1',
        action: 'ADMIN_USER_INVITED',
        targetType: 'AdminUser',
        targetKey: created.id,
      }),
    );
    expect(result.id).toBe(created.id);
    expect(result.status).toBe('INVITED');
  });
});
