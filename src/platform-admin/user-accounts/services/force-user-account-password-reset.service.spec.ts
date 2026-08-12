import { PrismaService } from '../../../prisma/prisma.service';
import { UsersRepository } from '../../../users/users.repository';
import { EnsureEmailDeliveryAvailableService } from '../../../email/services/ensure-email-delivery-available.service';
import { IssuePasswordResetCodeService } from '../../../password-reset/services/issue-password-reset-code.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { ForceUserAccountPasswordResetService } from './force-user-account-password-reset.service';

describe('ForceUserAccountPasswordResetService', () => {
  function makeService(options: {
    user?: unknown;
    emailDeliveryAvailable?: boolean;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findByIdForAdmin = jest
      .fn()
      .mockResolvedValue(
        options.user === undefined
          ? { id: 'u1', email: 'jane@example.com' }
          : options.user,
      );
    const usersRepository = { findByIdForAdmin } as unknown as UsersRepository;

    const ensureAvailable = jest.fn(() => {
      if (options.emailDeliveryAvailable === false) {
        return Promise.reject(
          Object.assign(new Error('disabled'), {
            code: 'EMAIL_DELIVERY_DISABLED',
          }),
        );
      }
      return Promise.resolve(undefined);
    });
    const ensureEmailDeliveryAvailable = {
      ensureAvailable,
    } as unknown as EnsureEmailDeliveryAvailableService;

    const issueForUser = jest.fn().mockResolvedValue({ issued: true });
    const issuePasswordResetCodeService = {
      issueForUser,
    } as unknown as IssuePasswordResetCodeService;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new ForceUserAccountPasswordResetService(
      prisma,
      usersRepository,
      ensureEmailDeliveryAvailable,
      issuePasswordResetCodeService,
      auditLogRepository,
    );

    return {
      service,
      findByIdForAdmin,
      ensureAvailable,
      issueForUser,
      write,
      $transaction,
    };
  }

  it('checks email-delivery availability FIRST, before looking up the user', async () => {
    const { service, findByIdForAdmin, ensureAvailable } = makeService({
      emailDeliveryAvailable: false,
    });

    await expect(
      service.forceUserAccountPasswordReset('admin-1', 'u1'),
    ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_DISABLED' });
    expect(ensureAvailable).toHaveBeenCalledTimes(1);
    expect(findByIdForAdmin).not.toHaveBeenCalled();
  });

  it('throws USER_ACCOUNT_NOT_FOUND for a nonexistent userId (no anti-enumeration needed here)', async () => {
    const { service } = makeService({ user: null });

    await expect(
      service.forceUserAccountPasswordReset('admin-1', 'missing'),
    ).rejects.toMatchObject({ code: 'USER_ACCOUNT_NOT_FOUND' });
  });

  it('calls IssuePasswordResetCodeService directly with the resolved user, and returns success:true', async () => {
    const { service, issueForUser } = makeService({});

    const result = await service.forceUserAccountPasswordReset('admin-1', 'u1');

    expect(issueForUser).toHaveBeenCalledWith('u1', 'jane@example.com');
    expect(result).toEqual({ success: true });
  });

  it('writes a distinct USER_ACCOUNT_PASSWORD_RESET_FORCED AdminAuditLog entry with no metadata beyond target', async () => {
    const { service, write } = makeService({});

    await service.forceUserAccountPasswordReset('admin-1', 'u1');

    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'USER_ACCOUNT_PASSWORD_RESET_FORCED',
        targetType: 'User',
        targetKey: 'u1',
      }),
    );
  });
});
