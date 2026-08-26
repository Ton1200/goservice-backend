import { AdminUserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EnsureEmailDeliveryAvailableService } from '../../../email/services/ensure-email-delivery-available.service';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { IssueAdminInviteService } from './issue-admin-invite.service';
import { ResendAdminInviteService } from './resend-admin-invite.service';

describe('ResendAdminInviteService', () => {
  const invitedAdmin = {
    id: 'admin-1',
    email: 'invited@example.com',
    displayName: 'Invited Admin',
    status: AdminUserStatus.INVITED,
    roleId: 'role-1',
    role: { id: 'role-1', name: 'SUPPORT_VIEWER', permissions: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(options?: { existing?: unknown; issued?: boolean }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const ensureAvailable = jest.fn().mockResolvedValue(undefined);
    const ensureEmailDeliveryAvailable = {
      ensureAvailable,
    } as unknown as EnsureEmailDeliveryAvailableService;

    const findById = jest
      .fn()
      .mockResolvedValue(
        options?.existing === undefined ? invitedAdmin : options.existing,
      );
    const adminUsersRepository = {
      findById,
    } as unknown as AdminUsersRepository;

    const issueForAdminUser = jest
      .fn()
      .mockResolvedValue({ issued: options?.issued ?? true });
    const issueAdminInviteService = {
      issueForAdminUser,
    } as unknown as IssueAdminInviteService;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new ResendAdminInviteService(
      prisma,
      ensureEmailDeliveryAvailable,
      adminUsersRepository,
      issueAdminInviteService,
      auditLogRepository,
    );

    return { service, findById, issueForAdminUser, write };
  }

  it('throws ADMIN_USER_NOT_FOUND when the id does not resolve to a real admin', async () => {
    const { service } = makeService({ existing: null });

    await expect(
      service.resendAdminInvite('actor-1', 'missing'),
    ).rejects.toMatchObject({ code: 'ADMIN_USER_NOT_FOUND' });
  });

  it('throws ADMIN_USER_NOT_INVITED when the target admin is ACTIVE (not INVITED)', async () => {
    const { service, issueForAdminUser } = makeService({
      existing: { ...invitedAdmin, status: AdminUserStatus.ACTIVE },
    });

    await expect(
      service.resendAdminInvite('actor-1', invitedAdmin.id),
    ).rejects.toMatchObject({ code: 'ADMIN_USER_NOT_INVITED' });
    expect(issueForAdminUser).not.toHaveBeenCalled();
  });

  it('throws ADMIN_USER_NOT_INVITED when the target admin is REVOKED (not INVITED)', async () => {
    const { service } = makeService({
      existing: { ...invitedAdmin, status: AdminUserStatus.REVOKED },
    });

    await expect(
      service.resendAdminInvite('actor-1', invitedAdmin.id),
    ).rejects.toMatchObject({ code: 'ADMIN_USER_NOT_INVITED' });
  });

  it('writes an ADMIN_USER_INVITE_RESENT AdminAuditLog row when a fresh invite was actually issued', async () => {
    const { service, write } = makeService({ issued: true });

    const result = await service.resendAdminInvite('actor-1', invitedAdmin.id);

    expect(result).toEqual({ success: true });
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'ADMIN_USER_INVITE_RESENT',
        targetType: 'AdminUser',
        targetKey: invitedAdmin.id,
      }),
    );
  });

  it('does NOT write an audit row when the resend cooldown made it a no-op', async () => {
    const { service, write } = makeService({ issued: false });

    const result = await service.resendAdminInvite('actor-1', invitedAdmin.id);

    expect(result).toEqual({ success: false });
    expect(write).not.toHaveBeenCalled();
  });
});
