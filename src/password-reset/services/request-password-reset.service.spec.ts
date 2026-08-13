import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { EnsureEmailDeliveryAvailableService } from '../../email/services/ensure-email-delivery-available.service';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { UsersRepository } from '../../users/users.repository';
import { PasswordResetEmailSenderPort } from '../ports/password-reset-email-sender.port';
import { PasswordResetRepository } from '../password-reset.repository';
import { IssuePasswordResetCodeService } from './issue-password-reset-code.service';
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

  function makeService(options: {
    user?: unknown;
    activeCode?: unknown;
    emailDeliveryAvailable?: boolean;
  }) {
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

    const ensureAvailable = jest.fn(() => {
      if (options.emailDeliveryAvailable === false) {
        return Promise.reject(
          new DomainException(
            'EMAIL_DELIVERY_DISABLED',
            'Email delivery is currently disabled.',
          ),
        );
      }
      return Promise.resolve(undefined);
    });
    const ensureEmailDeliveryAvailable = {
      ensureAvailable,
    } as unknown as EnsureEmailDeliveryAvailableService;

    const issuePasswordResetCodeService = new IssuePasswordResetCodeService(
      passwordResetRepository,
      passwordResetEmailSender,
      makeConfigService(),
    );

    const service = new RequestPasswordResetService(
      usersRepository,
      passwordHasher,
      ensureEmailDeliveryAvailable,
      issuePasswordResetCodeService,
    );

    return {
      service,
      findByEmail,
      invalidateCode,
      createPasswordResetCode,
      sendPasswordResetCode,
      hash,
      ensureAvailable,
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

  it('issues a new code for a PENDING_APPROVAL account too (now login-eligible)', async () => {
    const { service, createPasswordResetCode } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.PENDING_APPROVAL,
      },
      activeCode: null,
    });

    await service.requestPasswordReset('jane@example.com');

    expect(createPasswordResetCode).toHaveBeenCalled();
  });

  it('checks email-delivery availability FIRST, before the account lookup, and propagates its error', async () => {
    const { service, findByEmail, ensureAvailable } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      emailDeliveryAvailable: false,
    });

    await expect(
      service.requestPasswordReset('jane@example.com'),
    ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_DISABLED' });
    expect(ensureAvailable).toHaveBeenCalledTimes(1);
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('anti-enumeration: an unknown email and a real, eligible email get the IDENTICAL EMAIL_DELIVERY_DISABLED error when email delivery is unavailable', async () => {
    const unknown = makeService({ user: null, emailDeliveryAvailable: false });
    const real = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      emailDeliveryAvailable: false,
    });

    const unknownResult = await unknown.service
      .requestPasswordReset('nobody@example.com')
      .catch((error: unknown) => error);
    const realResult = await real.service
      .requestPasswordReset('jane@example.com')
      .catch((error: unknown) => error);

    expect(unknownResult).toBeInstanceOf(DomainException);
    expect(realResult).toBeInstanceOf(DomainException);
    expect((unknownResult as DomainException).code).toBe(
      'EMAIL_DELIVERY_DISABLED',
    );
    expect((realResult as DomainException).code).toBe(
      (unknownResult as DomainException).code,
    );
    expect((realResult as DomainException).message).toBe(
      (unknownResult as DomainException).message,
    );
    // Neither call ever reached the per-account lookup — proving the
    // gate genuinely runs before any account-existence signal could leak.
    expect(unknown.findByEmail).not.toHaveBeenCalled();
    expect(real.findByEmail).not.toHaveBeenCalled();
  });

  it('does not change existing successful behavior when email delivery is available', async () => {
    const { service, createPasswordResetCode } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'h',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
      activeCode: null,
      emailDeliveryAvailable: true,
    });

    const result = await service.requestPasswordReset('jane@example.com');

    expect(result).toEqual({ requested: true });
    expect(createPasswordResetCode).toHaveBeenCalled();
  });
});
