import { AdminUserStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { PasswordHasherPort } from '../../../users/ports/password-hasher.port';
import { AdminSessionPort } from '../ports/admin-session.port';
import { AdminUsersRepository } from '../admin-users.repository';
import { AdminLoginInput } from '../models/admin-login-input.model';
import { AdminLoginService } from './admin-login.service';

describe('AdminLoginService', () => {
  function makeService(overrides?: {
    adminUser?: unknown;
    passwordMatches?: boolean;
  }) {
    const findByEmail = jest
      .fn()
      .mockResolvedValue(overrides?.adminUser ?? null);
    const adminUsersRepository = {
      findByEmail,
    } as unknown as AdminUsersRepository;

    const hash = jest.fn().mockResolvedValue('decoy-hash');
    const verify = jest
      .fn()
      .mockResolvedValue(overrides?.passwordMatches ?? true);
    const passwordHasher = { hash, verify } as unknown as PasswordHasherPort;

    const createSession = jest.fn().mockResolvedValue({
      sessionToken: 'plaintext-admin-token',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const adminSessionPort = {
      createSession,
    } as unknown as AdminSessionPort;

    const service = new AdminLoginService(
      adminUsersRepository,
      passwordHasher,
      adminSessionPort,
    );

    return { service, findByEmail, verify, hash, createSession };
  }

  const validInput: AdminLoginInput = {
    email: 'admin@example.com',
    password: 'correct-password',
  };

  function activeAdminUser(overrides?: Record<string, unknown>) {
    return {
      id: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Admin One',
      passwordHash: 'real-hash',
      status: AdminUserStatus.ACTIVE,
      ...overrides,
    };
  }

  it('logs in successfully and creates an admin session', async () => {
    const { service, createSession, verify } = makeService({
      adminUser: activeAdminUser(),
    });

    const result = await service.adminLogin(validInput);

    expect(result).toEqual({
      adminUserId: 'admin-1',
      sessionToken: 'plaintext-admin-token',
      sessionExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      email: 'admin@example.com',
      displayName: 'Admin One',
      errors: [],
    });
    expect(verify).toHaveBeenCalledWith('real-hash', validInput.password);
    expect(createSession).toHaveBeenCalledWith({ adminUserId: 'admin-1' });
  });

  it('rejects with ADMIN_AUTHENTICATION_FAILED on a wrong password, never creating a session', async () => {
    const { service, createSession } = makeService({
      adminUser: activeAdminUser(),
      passwordMatches: false,
    });

    await expect(service.adminLogin(validInput)).rejects.toMatchObject({
      code: 'ADMIN_AUTHENTICATION_FAILED',
      message: 'Admin authentication failed.',
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects with ADMIN_AUTHENTICATION_FAILED for a nonexistent email, still verifying against a decoy hash, never creating a session', async () => {
    const { service, verify, hash, createSession } = makeService({
      adminUser: null,
    });

    await expect(service.adminLogin(validInput)).rejects.toMatchObject({
      code: 'ADMIN_AUTHENTICATION_FAILED',
    });
    expect(hash).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith('decoy-hash', validInput.password);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects with ADMIN_AUTHENTICATION_FAILED for an INVITED admin with no password set yet', async () => {
    const { service, createSession } = makeService({
      adminUser: activeAdminUser({
        passwordHash: null,
        status: AdminUserStatus.INVITED,
      }),
    });

    await expect(service.adminLogin(validInput)).rejects.toMatchObject({
      code: 'ADMIN_AUTHENTICATION_FAILED',
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects with ADMIN_AUTHENTICATION_FAILED for a REVOKED admin, never creating a session', async () => {
    const { service, createSession } = makeService({
      adminUser: activeAdminUser({ status: AdminUserStatus.REVOKED }),
    });

    await expect(service.adminLogin(validInput)).rejects.toMatchObject({
      code: 'ADMIN_AUTHENTICATION_FAILED',
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('memoizes the decoy hash across multiple calls (hash() computed only once)', async () => {
    const { service, hash } = makeService({ adminUser: null });

    await expect(service.adminLogin(validInput)).rejects.toBeInstanceOf(
      DomainException,
    );
    await expect(service.adminLogin(validInput)).rejects.toBeInstanceOf(
      DomainException,
    );

    expect(hash).toHaveBeenCalledTimes(1);
  });

  it('all thrown failures are DomainException instances', async () => {
    const { service } = makeService({ adminUser: null });
    await expect(service.adminLogin(validInput)).rejects.toBeInstanceOf(
      DomainException,
    );
  });
});
