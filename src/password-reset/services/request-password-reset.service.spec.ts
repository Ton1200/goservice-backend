import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { UsersRepository } from '../../users/users.repository';
import { PasswordResetEmailSenderPort } from '../ports/password-reset-email-sender.port';
import { PasswordResetRepository } from '../password-reset.repository';
import { RequestPasswordResetService } from './request-password-reset.service';

describe('RequestPasswordResetService', () => {
  const RESEND_COOLDOWN_SECONDS = 60;

  function makeConfigService() {
    return {
      get: jest.fn().mockReturnValue({
        codeTtlMinutes: 15,
        resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
        maxAttempts: 5,
      }),
    } as unknown as ConfigService;
  }

  function makeService(options: { user?: unknown; activeCode?: unknown }) {
    const findByEmail = jest.fn().mockResolvedValue(options.user ?? null);
    const usersRepository = { findByEmail } as unknown as UsersRepository;

    const findActivePasswordResetCode = jest
      .fn()
      .mockResolvedValue(options.activeCode ?? null);
    const invalidateCode = jest.fn().mockResolvedValue(undefined);
    const createPasswordResetCode = jest
      .fn()
      .mockResolvedValue({ id: 'new-code' });
    const passwordResetRepository = {
      findActivePasswordResetCode,
      invalidateCode,
      createPasswordResetCode,
    } as unknown as PasswordResetRepository;

    const sendPasswordResetCode = jest.fn().mockResolvedValue(undefined);
    const passwordResetEmailSender = {
      sendPasswordResetCode,
    } as unknown as PasswordResetEmailSenderPort;

    const hash = jest.fn().mockResolvedValue('decoy-hash');
    const passwordHasher = { hash } as unknown as PasswordHasherPort;

    const service = new RequestPasswordResetService(
      usersRepository,
      passwordResetRepository,
      passwordResetEmailSender,
      passwordHasher,
      makeConfigService(),
    );

    return {
      service,
      findByEmail,
      invalidateCode,
      createPasswordResetCode,
      sendPasswordResetCode,
      hash,
    };
  }

  it('returns requested:true with no DB write and still runs the decoy hash when the user does not exist', async () => {
    const { service, createPasswordResetCode, hash } = makeService({
      user: null,
    });

    const result = await service.requestPasswordReset('nobody@example.com');

    expect(result).toEqual({ requested: true });
    expect(createPasswordResetCode).not.toHaveBeenCalled();
    expect(hash).toHaveBeenCalledTimes(1);
  });

  it('returns the same neutral result, with no DB write, for a social-only account', async () => {
    const { service, createPasswordResetCode, hash } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        authProvider: AuthProvider.GOOGLE,
        passwordHash: null,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });

    const result = await service.requestPasswordReset('jane@example.com');

    expect(result).toEqual({ requested: true });
    expect(createPasswordResetCode).not.toHaveBeenCalled();
    expect(hash).toHaveBeenCalledTimes(1);
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.PENDING_APPROVAL,
    UserAccountStatus.REJECTED,
  ])(
    'returns the same neutral result, with no DB write, for a non-login-eligible account (%s)',
    async (accountStatus) => {
      const { service, createPasswordResetCode } = makeService({
        user: {
          id: 'u1',
          email: 'jane@example.com',
          authProvider: AuthProvider.PASSWORD,
          passwordHash: 'h',
          accountStatus,
        },
      });

      const result = await service.requestPasswordReset('jane@example.com');

      expect(result).toEqual({ requested: true });
      expect(createPasswordResetCode).not.toHaveBeenCalled();
    },
  );

  it('is idempotent within the cooldown: no new code, no email sent', async () => {
    const createdAt = new Date(Date.now() - 10_000); // 10s ago, within 60s cooldown
    const {
      service,
      createPasswordResetCode,
      invalidateCode,
      sendPasswordResetCode,
    } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: { id: 'code-1', createdAt },
    });

    const result = await service.requestPasswordReset('jane@example.com');

    expect(result).toEqual({ requested: true });
    expect(createPasswordResetCode).not.toHaveBeenCalled();
    expect(invalidateCode).not.toHaveBeenCalled();
    expect(sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it('issues a new code once the cooldown has elapsed, invalidating the prior one', async () => {
    const createdAt = new Date(Date.now() - 120_000); // past 60s cooldown
    const {
      service,
      invalidateCode,
      createPasswordResetCode,
      sendPasswordResetCode,
    } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: { id: 'code-1', createdAt },
    });

    const result = await service.requestPasswordReset('jane@example.com');

    expect(result).toEqual({ requested: true });
    expect(invalidateCode).toHaveBeenCalledWith('code-1');
    expect(createPasswordResetCode).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    );
    expect(sendPasswordResetCode).toHaveBeenCalledWith(
      'jane@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('issues a new code when the user has no active code at all', async () => {
    const { service, createPasswordResetCode } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.APPROVED,
      },
      activeCode: null,
    });

    await service.requestPasswordReset('jane@example.com');

    expect(createPasswordResetCode).toHaveBeenCalled();
  });
});
