import { ConfigService } from '@nestjs/config';
import { UsersRepository } from '../users.repository';
import { hashVerificationCode } from './verification-code.util';
import { VerifyEmailCodeService } from './verify-email-code.service';

describe('VerifyEmailCodeService', () => {
  function makeConfigService() {
    return {
      get: jest.fn().mockReturnValue({
        codeTtlMinutes: 15,
        resendCooldownSeconds: 60,
        maxAttempts: 5,
      }),
    } as unknown as ConfigService;
  }

  function makeService(options: { user?: unknown; activeCode?: unknown }) {
    const findByEmail = jest.fn().mockResolvedValue(options.user ?? null);
    const findActiveEmailVerificationCode = jest
      .fn()
      .mockResolvedValue(options.activeCode ?? null);
    const incrementAttempts = jest.fn().mockResolvedValue(undefined);
    const consumeCode = jest.fn().mockResolvedValue(undefined);
    const markEmailVerified = jest.fn().mockResolvedValue(undefined);
    const usersRepository = {
      findByEmail,
      findActiveEmailVerificationCode,
      incrementAttempts,
      consumeCode,
      markEmailVerified,
    } as unknown as UsersRepository;

    const service = new VerifyEmailCodeService(
      usersRepository,
      makeConfigService(),
    );
    return {
      service,
      incrementAttempts,
      consumeCode,
      markEmailVerified,
    };
  }

  const GENERIC_FAILURE = {
    success: false,
    errors: [
      {
        code: 'CODE_INVALID_OR_EXPIRED',
        message: expect.any(String) as unknown,
      },
    ],
  };

  it('returns the generic failure when the user does not exist', async () => {
    const { service } = makeService({ user: null });

    const result = await service.verifyEmailCode({
      email: 'nobody@example.com',
      code: '123456',
    });

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it('returns the generic failure when there is no active code', async () => {
    const { service } = makeService({ user: { id: 'u1' }, activeCode: null });

    const result = await service.verifyEmailCode({
      email: 'jane@example.com',
      code: '123456',
    });

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it('returns the generic failure and increments attempts on a code mismatch', async () => {
    const { service, incrementAttempts } = makeService({
      user: { id: 'u1' },
      activeCode: {
        id: 'code-1',
        attemptsCount: 0,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashVerificationCode('654321'),
      },
    });

    const result = await service.verifyEmailCode({
      email: 'jane@example.com',
      code: '123456',
    });

    expect(result).toEqual(GENERIC_FAILURE);
    expect(incrementAttempts).toHaveBeenCalledWith('code-1');
  });

  it('returns the generic failure when attemptsCount has reached the max', async () => {
    const { service } = makeService({
      user: { id: 'u1' },
      activeCode: {
        id: 'code-1',
        attemptsCount: 5,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashVerificationCode('123456'),
      },
    });

    const result = await service.verifyEmailCode({
      email: 'jane@example.com',
      code: '123456',
    });

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it('returns the generic failure when the code has expired', async () => {
    const { service } = makeService({
      user: { id: 'u1' },
      activeCode: {
        id: 'code-1',
        attemptsCount: 0,
        expiresAt: new Date(Date.now() - 1_000),
        codeHash: hashVerificationCode('123456'),
      },
    });

    const result = await service.verifyEmailCode({
      email: 'jane@example.com',
      code: '123456',
    });

    expect(result).toEqual(GENERIC_FAILURE);
  });

  it('succeeds, consumes the code, and marks the user EMAIL_VERIFIED on a match', async () => {
    const { service, consumeCode, markEmailVerified } = makeService({
      user: { id: 'u1' },
      activeCode: {
        id: 'code-1',
        attemptsCount: 0,
        expiresAt: new Date(Date.now() + 60_000),
        codeHash: hashVerificationCode('123456'),
      },
    });

    const result = await service.verifyEmailCode({
      email: 'jane@example.com',
      code: '123456',
    });

    expect(result).toEqual({ success: true, errors: [] });
    expect(consumeCode).toHaveBeenCalledWith('code-1');
    expect(markEmailVerified).toHaveBeenCalledWith('u1');
  });
});
