import { AdminUserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PasswordHasherPort } from '../../../users/ports/password-hasher.port';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AdminInvitesRepository } from '../admin-invites.repository';
import { hashAdminInviteToken } from './admin-invite-token.util';
import { AcceptAdminInviteService } from './accept-admin-invite.service';

describe('AcceptAdminInviteService', () => {
  const RAW_TOKEN = 'a-known-raw-token';
  const validInvite = {
    id: 'invite-1',
    adminUserId: 'admin-1',
    tokenHash: hashAdminInviteToken(RAW_TOKEN),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    consumedAt: null as Date | null,
    invalidatedAt: null as Date | null,
    createdAt: new Date(),
  };

  function makeService(overrides?: { invite?: unknown }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findByTokenHash = jest
      .fn()
      .mockResolvedValue(
        overrides?.invite === undefined ? validInvite : overrides.invite,
      );
    const consume = jest.fn().mockResolvedValue({ id: 'invite-1' });
    const adminInvitesRepository = {
      findByTokenHash,
      consume,
    } as unknown as AdminInvitesRepository;

    const updateForAdmin = jest.fn().mockResolvedValue({ id: 'admin-1' });
    const adminUsersRepository = {
      updateForAdmin,
    } as unknown as AdminUsersRepository;

    const hash = jest.fn().mockResolvedValue('hashed-password');
    const passwordHasher = { hash } as unknown as PasswordHasherPort;

    const service = new AcceptAdminInviteService(
      prisma,
      adminInvitesRepository,
      adminUsersRepository,
      passwordHasher,
    );

    return { service, findByTokenHash, consume, updateForAdmin, hash };
  }

  it('activates the admin and consumes the invite on a valid, unexpired, unconsumed, uninvalidated token', async () => {
    const { service, updateForAdmin, consume } = makeService();

    const result = await service.acceptAdminInvite({
      token: RAW_TOKEN,
      newPassword: 'a-strong-password-1',
    });

    expect(result).toEqual({ success: true, errors: [] });
    expect(updateForAdmin).toHaveBeenCalledWith(expect.anything(), 'admin-1', {
      passwordHash: 'hashed-password',
      status: AdminUserStatus.ACTIVE,
    });
    expect(consume).toHaveBeenCalledWith(expect.anything(), 'invite-1');
  });

  it.each([
    ['a token that does not exist at all', null],
    ['an already-consumed invite', { ...validInvite, consumedAt: new Date() }],
    [
      'an already-invalidated invite',
      { ...validInvite, invalidatedAt: new Date() },
    ],
    [
      'an expired invite',
      { ...validInvite, expiresAt: new Date(Date.now() - 1000) },
    ],
  ])(
    'collapses %s into the SAME generic ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED result, with no write attempted',
    async (_label, invite) => {
      const { service, updateForAdmin, consume } = makeService({ invite });

      const result = await service.acceptAdminInvite({
        token: RAW_TOKEN,
        newPassword: 'a-strong-password-1',
      });

      expect(result).toEqual({
        success: false,
        errors: [
          {
            code: 'ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED',
            message: expect.any(String) as unknown,
          },
        ],
      });
      expect(updateForAdmin).not.toHaveBeenCalled();
      expect(consume).not.toHaveBeenCalled();
    },
  );
});
