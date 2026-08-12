import { ConfigService } from '@nestjs/config';
import { UserAccountStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { EnsureEmailDeliveryAvailableService } from '../../email/services/ensure-email-delivery-available.service';
import { VerificationCodeSenderPort } from '../ports/verification-code-sender.port';
import { UsersRepository } from '../users.repository';
import { ResendVerificationCodeService } from './resend-verification-code.service';

describe('ResendVerificationCodeService', () => {
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
    const findActiveEmailVerificationCode = jest
      .fn()
      .mockResolvedValue(options.activeCode ?? null);
    const invalidateCode = jest.fn().mockResolvedValue(undefined);
    const createEmailVerificationCode = jest
      .fn()
      .mockResolvedValue({ id: 'new-code' });
    const usersRepository = {
      findByEmail,
      findActiveEmailVerificationCode,
      invalidateCode,
      createEmailVerificationCode,
    } as unknown as UsersRepository;

    const sendVerificationCode = jest.fn().mockResolvedValue(undefined);
    const verificationCodeSender = {
      sendVerificationCode,
    } as unknown as VerificationCodeSenderPort;

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

    const service = new ResendVerificationCodeService(
      usersRepository,
      verificationCodeSender,
      makeConfigService(),
      ensureEmailDeliveryAvailable,
    );
    return {
      service,
      findByEmail,
      invalidateCode,
      createEmailVerificationCode,
      sendVerificationCode,
      ensureAvailable,
    };
  }

  it('returns a synthetic resent:true response, with no DB write, when the user does not exist', async () => {
    const { service, createEmailVerificationCode, invalidateCode } =
      makeService({ user: null });

    const result = await service.resendVerificationCode('nobody@example.com');

    expect(result.resent).toBe(true);
    expect(result.nextResendAvailableAt).toBeInstanceOf(Date);
    expect(createEmailVerificationCode).not.toHaveBeenCalled();
    expect(invalidateCode).not.toHaveBeenCalled();
  });

  it('returns the same synthetic shape, with no DB write, when the user is already EMAIL_VERIFIED', async () => {
    const { service, createEmailVerificationCode } = makeService({
      user: { id: 'u1', accountStatus: UserAccountStatus.EMAIL_VERIFIED },
    });

    const result = await service.resendVerificationCode('jane@example.com');

    expect(result.resent).toBe(true);
    expect(createEmailVerificationCode).not.toHaveBeenCalled();
  });

  it('is idempotent within the cooldown: returns the existing nextResendAvailableAt, no new code', async () => {
    const createdAt = new Date(Date.now() - 10_000); // 10s ago, within 60s cooldown
    const {
      service,
      createEmailVerificationCode,
      invalidateCode,
      sendVerificationCode,
    } = makeService({
      user: {
        id: 'u1',
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
      },
      activeCode: { id: 'code-1', createdAt },
    });

    const result = await service.resendVerificationCode('jane@example.com');

    const expectedNextResendAvailableAt = new Date(
      createdAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000,
    );
    expect(result.resent).toBe(true);
    expect(result.nextResendAvailableAt).toEqual(expectedNextResendAvailableAt);
    expect(createEmailVerificationCode).not.toHaveBeenCalled();
    expect(invalidateCode).not.toHaveBeenCalled();
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it('issues a new code once the cooldown has elapsed, invalidating the prior one', async () => {
    const createdAt = new Date(Date.now() - 120_000); // 120s ago, past 60s cooldown
    const {
      service,
      invalidateCode,
      createEmailVerificationCode,
      sendVerificationCode,
    } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
      },
      activeCode: { id: 'code-1', createdAt },
    });

    const result = await service.resendVerificationCode('jane@example.com');

    expect(result.resent).toBe(true);
    expect(invalidateCode).toHaveBeenCalledWith('code-1');
    expect(createEmailVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    );
    expect(sendVerificationCode).toHaveBeenCalledWith(
      'jane@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('issues a new code when the user has no active code at all', async () => {
    const { service, createEmailVerificationCode } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
      },
      activeCode: null,
    });

    await service.resendVerificationCode('jane@example.com');

    expect(createEmailVerificationCode).toHaveBeenCalled();
  });

  it('checks email-delivery availability FIRST, before any DB lookup, and propagates its error', async () => {
    const { service, findByEmail, ensureAvailable } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
      },
      emailDeliveryAvailable: false,
    });

    await expect(
      service.resendVerificationCode('jane@example.com'),
    ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_DISABLED' });
    expect(ensureAvailable).toHaveBeenCalledTimes(1);
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('does not change existing successful behavior when email delivery is available', async () => {
    const { service, sendVerificationCode } = makeService({
      user: {
        id: 'u1',
        email: 'jane@example.com',
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
      },
      activeCode: null,
      emailDeliveryAvailable: true,
    });

    const result = await service.resendVerificationCode('jane@example.com');

    expect(result.resent).toBe(true);
    expect(sendVerificationCode).toHaveBeenCalled();
  });
});
