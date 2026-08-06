import { UserAccountStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { SessionPort } from '../ports/session.port';
import { LoginInput } from '../models/login-input.model';
import { UsersRepository } from '../../users/users.repository';
import { LoginService } from './login.service';

describe('LoginService', () => {
  function makeService(overrides?: {
    user?: unknown;
    passwordMatches?: boolean;
  }) {
    const findByEmail = jest.fn().mockResolvedValue(overrides?.user ?? null);
    const usersRepository = { findByEmail } as unknown as UsersRepository;

    const hash = jest.fn().mockResolvedValue('decoy-hash');
    const verify = jest
      .fn()
      .mockResolvedValue(overrides?.passwordMatches ?? true);
    const passwordHasher = { hash, verify } as unknown as PasswordHasherPort;

    const createSession = jest.fn().mockResolvedValue({
      sessionToken: 'plaintext-token',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const sessionPort = { createSession } as unknown as SessionPort;

    const service = new LoginService(
      usersRepository,
      passwordHasher,
      sessionPort,
    );

    return { service, findByEmail, verify, hash, createSession };
  }

  const validInput: LoginInput = {
    email: 'jane@example.com',
    password: 'correct-password',
  };

  function eligibleUser(overrides?: Record<string, unknown>) {
    return {
      id: 'user-1',
      email: 'jane@example.com',
      passwordHash: 'real-hash',
      accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      ...overrides,
    };
  }

  it('logs in successfully (EMAIL_VERIFIED) and creates a session', async () => {
    const { service, createSession, verify } = makeService({
      user: eligibleUser(),
    });

    const result = await service.login(validInput);

    expect(result).toEqual({
      userId: 'user-1',
      sessionToken: 'plaintext-token',
      sessionExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      errors: [],
    });
    expect(verify).toHaveBeenCalledWith('real-hash', validInput.password);
    expect(createSession).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('logs in successfully (APPROVED) and creates a session', async () => {
    const { service, createSession } = makeService({
      user: eligibleUser({ accountStatus: UserAccountStatus.APPROVED }),
    });

    const result = await service.login(validInput);

    expect(result.userId).toBe('user-1');
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('rejects with AUTHENTICATION_FAILED on a wrong password, never creating a session', async () => {
    const { service, createSession } = makeService({
      user: eligibleUser(),
      passwordMatches: false,
    });

    await expect(service.login(validInput)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      message: 'Authentication failed.',
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects with AUTHENTICATION_FAILED for a nonexistent email, still verifying against a decoy hash, never creating a session', async () => {
    const { service, verify, hash, createSession } = makeService({
      user: null,
    });

    await expect(service.login(validInput)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    expect(hash).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith('decoy-hash', validInput.password);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects with AUTHENTICATION_FAILED for a social-only account (no passwordHash), never creating a session', async () => {
    const { service, verify, createSession } = makeService({
      user: eligibleUser({ passwordHash: null }),
    });

    await expect(service.login(validInput)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    expect(verify).toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.PENDING_APPROVAL,
    UserAccountStatus.REJECTED,
  ])(
    'rejects with AUTHENTICATION_FAILED for ineligible status %s, never creating a session',
    async (accountStatus) => {
      const { service, createSession } = makeService({
        user: eligibleUser({ accountStatus }),
      });

      await expect(service.login(validInput)).rejects.toMatchObject({
        code: 'AUTHENTICATION_FAILED',
      });
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('memoizes the decoy hash across multiple calls (hash() computed only once)', async () => {
    const { service, hash } = makeService({ user: null });

    await expect(service.login(validInput)).rejects.toBeInstanceOf(
      DomainException,
    );
    await expect(service.login(validInput)).rejects.toBeInstanceOf(
      DomainException,
    );

    expect(hash).toHaveBeenCalledTimes(1);
  });

  it('all thrown failures are DomainException instances', async () => {
    const { service } = makeService({ user: null });
    await expect(service.login(validInput)).rejects.toBeInstanceOf(
      DomainException,
    );
  });
});
