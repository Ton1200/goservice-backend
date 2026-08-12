import { PrismaService } from '../../../prisma/prisma.service';
import { UsersRepository } from '../../../users/users.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { DeleteUserAccountService } from './delete-user-account.service';

describe('DeleteUserAccountService', () => {
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

  function makeService(options: { existing?: unknown } = {}) {
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
    const deleteForAdmin = jest
      .fn()
      .mockImplementation((_tx: unknown, id: string) =>
        Promise.resolve({ ...makeExisting(), id }),
      );
    const usersRepository = {
      findByIdForAdmin,
      deleteForAdmin,
    } as unknown as UsersRepository;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new DeleteUserAccountService(
      prisma,
      usersRepository,
      auditLogRepository,
    );

    return {
      service,
      $transaction,
      fakeTx,
      findByIdForAdmin,
      deleteForAdmin,
      write,
    };
  }

  it('throws USER_ACCOUNT_NOT_FOUND when the id does not resolve to a real user, without opening a transaction', async () => {
    const { service, $transaction } = makeService({ existing: null });

    await expect(
      service.deleteUserAccount('admin-1', 'missing'),
    ).rejects.toMatchObject({ code: 'USER_ACCOUNT_NOT_FOUND' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('writes a USER_ACCOUNT_DELETED audit log entry BEFORE deleting the user, inside the SAME $transaction, and returns success: true', async () => {
    const { service, $transaction, fakeTx, deleteForAdmin, write } =
      makeService({
        existing: makeExisting({
          email: 'jane@example.com',
          customerProfile: { id: 'cp1' },
          professionalProfile: null,
        }),
      });

    const result = await service.deleteUserAccount('admin-1', 'u1');

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'USER_ACCOUNT_DELETED',
        targetType: 'User',
        targetKey: 'u1',
        metadata: {
          email: 'jane@example.com',
          hadCustomerProfile: true,
          hadProfessionalProfile: false,
        },
      }),
    );
    expect(deleteForAdmin).toHaveBeenCalledWith(fakeTx, 'u1');

    // The audit-log write must be issued before the delete call, in source
    // order within the same transaction callback — proven by mock call
    // ordering rather than assumed.
    const writeOrder = write.mock.invocationCallOrder[0];
    const deleteOrder = deleteForAdmin.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(deleteOrder);

    expect(result).toEqual({ success: true });
  });
});
