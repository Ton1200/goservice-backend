import { UserAccountStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UsersRepository } from '../../../users/users.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { UpdateUserAccountService } from './update-user-account.service';

describe('UpdateUserAccountService', () => {
  function makeExisting(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phoneCountryCode: '+54',
      phoneNumber: '91122334455',
      accountStatus: 'EMAIL_VERIFIED',
      authProvider: 'PASSWORD',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      customerProfile: null,
      professionalProfile: null,
      ...overrides,
    };
  }

  function makeService(options: { existing?: unknown; emailOwner?: unknown }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findByIdForAdmin = jest
      .fn()
      .mockResolvedValue(
        options.existing === undefined ? makeExisting() : options.existing,
      );
    const findByEmail = jest.fn().mockResolvedValue(options.emailOwner ?? null);
    const updateForAdmin = jest
      .fn()
      .mockImplementation(
        (_tx: unknown, id: string, data: Record<string, unknown>) =>
          Promise.resolve({ ...makeExisting(), id, ...data }),
      );
    const usersRepository = {
      findByIdForAdmin,
      findByEmail,
      updateForAdmin,
    } as unknown as UsersRepository;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new UpdateUserAccountService(
      prisma,
      usersRepository,
      auditLogRepository,
    );

    return {
      service,
      $transaction,
      findByIdForAdmin,
      findByEmail,
      updateForAdmin,
      write,
      fakeTx,
    };
  }

  it('throws USER_ACCOUNT_NOT_FOUND when the id does not resolve to a real user', async () => {
    const { service } = makeService({ existing: null });

    await expect(
      service.updateUserAccount('admin-1', 'missing', { firstName: 'X' }),
    ).rejects.toMatchObject({ code: 'USER_ACCOUNT_NOT_FOUND' });
  });

  it('only updates fields actually present in the input (partial patch)', async () => {
    const { service, updateForAdmin } = makeService({});

    await service.updateUserAccount('admin-1', 'u1', { firstName: 'Updated' });

    expect(updateForAdmin).toHaveBeenCalledWith(expect.anything(), 'u1', {
      firstName: 'Updated',
    });
  });

  it('is a no-op (no write, no audit log) when nothing in the input differs from the current state', async () => {
    const { service, updateForAdmin, write } = makeService({});

    await service.updateUserAccount('admin-1', 'u1', { firstName: 'Jane' });

    expect(updateForAdmin).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects with USER_ACCOUNT_EMAIL_TAKEN when the email belongs to a different user, with no write attempted', async () => {
    const { service, updateForAdmin } = makeService({
      emailOwner: { id: 'someone-else' },
    });

    await expect(
      service.updateUserAccount('admin-1', 'u1', {
        email: 'taken@example.com',
      }),
    ).rejects.toMatchObject({ code: 'USER_ACCOUNT_EMAIL_TAKEN' });
    expect(updateForAdmin).not.toHaveBeenCalled();
  });

  it('allows the email to stay assigned to the SAME user (no-op for that field)', async () => {
    const { service, findByEmail, updateForAdmin } = makeService({
      emailOwner: { id: 'u1' },
    });

    await service.updateUserAccount('admin-1', 'u1', {
      email: 'jane@example.com', // same as existing.email — no real change
      firstName: 'Updated',
    });

    // findByEmail is only reached when email actually DIFFERS from current
    expect(findByEmail).not.toHaveBeenCalled();
    expect(updateForAdmin).toHaveBeenCalledWith(expect.anything(), 'u1', {
      firstName: 'Updated',
    });
  });

  it('forces accountStatus to PENDING_EMAIL_VERIFICATION when email changes, overriding any accountStatus also present in the same input', async () => {
    const { service, updateForAdmin } = makeService({});

    await service.updateUserAccount('admin-1', 'u1', {
      email: 'new@example.com',
      accountStatus: UserAccountStatus.APPROVED,
    });

    expect(updateForAdmin).toHaveBeenCalledWith(expect.anything(), 'u1', {
      email: 'new@example.com',
      accountStatus: 'PENDING_EMAIL_VERIFICATION',
    });
  });

  it('applies an explicit accountStatus change when email is NOT also changing', async () => {
    const { service, updateForAdmin } = makeService({});

    await service.updateUserAccount('admin-1', 'u1', {
      accountStatus: UserAccountStatus.APPROVED,
    });

    expect(updateForAdmin).toHaveBeenCalledWith(expect.anything(), 'u1', {
      accountStatus: 'APPROVED',
    });
  });

  it('writes a USER_ACCOUNT_UPDATED AdminAuditLog row inside the SAME $transaction as the User update', async () => {
    const { service, write, $transaction, fakeTx } = makeService({});

    await service.updateUserAccount('admin-1', 'u1', { firstName: 'Updated' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'USER_ACCOUNT_UPDATED',
        targetType: 'User',
        targetKey: 'u1',
      }),
    );
  });
});
