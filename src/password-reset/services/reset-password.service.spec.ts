import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import { SessionPort } from '../../auth/ports/session.port';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { UsersRepository } from '../../users/users.repository';
import { PasswordResetRepository } from '../password-reset.repository';
import { hashPasswordResetCode } from './password-reset-code.util';
import { ResetPasswordService } from './reset-password.service';

describe('ResetPasswordService', () => {
  function makeConfigService() {
    return {
      get: jest.fn().mockReturnValue({
        codeTtlMinutes: 15,
        resendCooldownSeconds: 60,
        maxAttempts: 5,
      }),
    } as unknown as ConfigService;
  }

  function makeService(options: {
    user?: unknown;
    activeCode?: unknown;
    verifyResult?: boolean;
  }) {
    const findByEmail = jest.fn().mockResolvedValue(options.user ?? null);
    const updatePasswordHash = jest.fn().mockResolvedValue(undefined);
    const usersRepository = {
      findByEmail,
      updatePasswordHash,
    } as unknown as UsersRepository;

    const findActivePasswordResetCode = jest
      .fn()
      .mockResolvedValue(options.activeCode ?? null);
    const incrementAttempts = jest.fn().mockResolvedValue(undefined);
    const consumeCode = jest.fn().mockResolvedValue(undefined);
    const invalidateOtherActiveCodes = jest.fn().mockResolvedValue(undefined);
    const passwordResetRepository = {
      findActivePasswordResetCode,
      incrementAttempts,
      consumeCode,
      invalidateOtherActiveCodes,
    } as unknown as PasswordResetRepository;

    const hash = jest.fn().mockResolvedValue('new-hash');
    // Defaults to `false` (new password differs from current) so every
    // pre-existing test — written before this check existed — keeps
    // reaching the same code path it did before.
    const verify = jest.fn().mockResolvedValue(options.verifyResult ?? false);
    const passwordHasher = { hash, verify } as unknown as PasswordHasherPort;

    const revokeAllSessionsForUser = jest.fn().mockResolvedValue(1);
    const sessionPort = {
      revokeAllSessionsForUser,
    } as unknown as SessionPort;

    const service = new ResetPasswordService(
      usersRepository,
      passwordResetRepository,
      passwordHasher,
      sessionPort,
      makeConfigService(),
    );

    return {
      service,
      updatePasswordHash,
      incrementAttempts,
      consumeCode,
      invalidateOtherActiveCodes,
      hash,
      verify,
      revokeAllSessionsForUser,
    };
  }

  const GENERIC_FAILURE = {
    success: false,
    errors: [
      {
        code: 'RESET_CODE_INVALID_OR_EXPIRED',
        message: expect.any(String) as unknown,
      },
    ],
  };

  const VALID_INPUT = {
    email: 'jane@example.com',
    code: '123456',
    newPassword: 'new-super-secret-1',
  };

  it('returns the generic failure when the user does not exist', async () => {
    const { service } = makeService({ user: null });

    const result = await service.resetPassword(VALID_INPUT);

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it('returns the generic failure for a social-only account', async () => {
    const { service } = makeService({
      user: {
        id: 'u1',
        authProvider: AuthProvider.GOOGLE,
        passwordHash: null,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });

    const result = await service.resetPassword(VALID_INPUT);

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.REJECTED,
  ])(
    'returns the generic failure for a non-login-eligible account (%s)',
    async (accountStatus) => {
      const { service } = makeService({
        user: {
          id: 'u1',
          authProvider: AuthProvider.PASSWORD,
          passwordHash: 'h',
          accountStatus,
        },
      });

      const result = await service.resetPassword(VALID_INPUT);

      expect(result).toEqual(GENERIC_FAILURE);
    },
  );

  it('returns the generic failure when there is no active code', async () => {
    const { service } = makeService({
      user: {
        id: 'u1',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: null,
    });

    const result = await service.resetPassword(VALID_INPUT);

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it('returns the generic failure and increments attempts on a code mismatch', async () => {
    const { service, incrementAttempts } = makeService({
      user: {
        id: 'u1',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: {
        id: 'code-1',
        attemptsCount: 0,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashPasswordResetCode('654321'),
      },
    });

    const result = await service.resetPassword(VALID_INPUT);

    expect(result).toEqual(GENERIC_FAILURE);
    expect(incrementAttempts).toHaveBeenCalledWith('code-1');
  });

  it('returns the generic failure when attemptsCount has reached the max', async () => {
    const { service } = makeService({
      user: {
        id: 'u1',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: {
        id: 'code-1',
        attemptsCount: 5,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashPasswordResetCode('123456'),
      },
    });

    const result = await service.resetPassword(VALID_INPUT);

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it('returns the generic failure when the code has expired', async () => {
    const { service } = makeService({
      user: {
        id: 'u1',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: {
        id: 'code-1',
        attemptsCount: 0,
        expiresAt: new Date(Date.now() - 1_000),
        codeHash: hashPasswordResetCode('123456'),
      },
    });

    const result = await service.resetPassword(VALID_INPUT);

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it('succeeds: hashes the new password, updates it, consumes the code, invalidates other codes, and revokes all sessions', async () => {
    const {
      service,
      updatePasswordHash,
      consumeCode,
      invalidateOtherActiveCodes,
      hash,
      revokeAllSessionsForUser,
    } = makeService({
      user: {
        id: 'u1',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'old-hash',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: {
        id: 'code-1',
        attemptsCount: 0,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashPasswordResetCode('123456'),
      },
    });

    const result = await service.resetPassword(VALID_INPUT);

    expect(result).toEqual({ success: true, errors: [] });
    expect(hash).toHaveBeenCalledWith(VALID_INPUT.newPassword);
    expect(updatePasswordHash).toHaveBeenCalledWith('u1', 'new-hash');
    expect(consumeCode).toHaveBeenCalledWith('code-1');
    expect(invalidateOtherActiveCodes).toHaveBeenCalledWith('u1', 'code-1');
    expect(revokeAllSessionsForUser).toHaveBeenCalledWith('u1');
  });

  it('rejects with NEW_PASSWORD_SAME_AS_CURRENT when the new password matches the current one, without incrementing attempts, consuming/invalidating the code, or revoking sessions', async () => {
    const {
      service,
      verify,
      updatePasswordHash,
      incrementAttempts,
      consumeCode,
      invalidateOtherActiveCodes,
      revokeAllSessionsForUser,
    } = makeService({
      user: {
        id: 'u1',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'old-hash',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: {
        id: 'code-1',
        attemptsCount: 0,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashPasswordResetCode('123456'),
      },
      verifyResult: true,
    });

    const result = await service.resetPassword(VALID_INPUT);

    expect(result).toEqual({
      success: false,
      errors: [
        {
          code: 'NEW_PASSWORD_SAME_AS_CURRENT',
          message: expect.any(String) as unknown,
        },
      ],
    });
    expect(verify).toHaveBeenCalledWith('old-hash', VALID_INPUT.newPassword);
    expect(updatePasswordHash).not.toHaveBeenCalled();
    expect(incrementAttempts).not.toHaveBeenCalled();
    expect(consumeCode).not.toHaveBeenCalled();
    expect(invalidateOtherActiveCodes).not.toHaveBeenCalled();
    expect(revokeAllSessionsForUser).not.toHaveBeenCalled();
  });

  it('never passes the plaintext newPassword to any repository call', async () => {
    const { service, updatePasswordHash } = makeService({
      user: {
        id: 'u1',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'old-hash',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: {
        id: 'code-1',
        attemptsCount: 0,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashPasswordResetCode('123456'),
      },
    });

    await service.resetPassword(VALID_INPUT);

    const [, passedHash] = updatePasswordHash.mock.calls[0] as [string, string];
    expect(passedHash).not.toBe(VALID_INPUT.newPassword);
  });
});
