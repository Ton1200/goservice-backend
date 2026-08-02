import { AuthProvider, UserAccountStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';
import { SessionPort } from '../ports/session.port';
import { UsersRepository } from '../../users/users.repository';
import { SocialIdentityValidationService } from './social-identity-validation.service';
import { SocialLoginService } from './social-login.service';

describe('SocialLoginService', () => {
  const VALIDATED_IDENTITY = {
    subject: 'google-subject-123',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
  };

  function makeService(
    options: {
      user?: unknown;
      validateError?: unknown;
    } = {},
  ) {
    const findBySocialProviderSubject = jest
      .fn()
      .mockResolvedValue(options.user ?? null);
    const usersRepository = {
      findBySocialProviderSubject,
    } as unknown as UsersRepository;

    const validate = options.validateError
      ? jest.fn().mockRejectedValue(options.validateError)
      : jest.fn().mockResolvedValue(VALIDATED_IDENTITY);
    const socialIdentityValidationService = {
      validate,
    } as unknown as SocialIdentityValidationService;

    const createSession = jest.fn().mockResolvedValue({
      sessionToken: 'plaintext-token',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const sessionPort = { createSession } as unknown as SessionPort;

    const service = new SocialLoginService(
      usersRepository,
      socialIdentityValidationService,
      sessionPort,
    );
    return {
      service,
      findBySocialProviderSubject,
      validate,
      createSession,
    };
  }

  const input = { provider: SocialProvider.GOOGLE, identityToken: 'token' };

  function eligibleUser(overrides?: Record<string, unknown>) {
    return {
      id: 'existing-user-1',
      accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      ...overrides,
    };
  }

  it('logs in a returning, eligible (EMAIL_VERIFIED) social user via (authProvider, subject) and creates a session', async () => {
    const { service, findBySocialProviderSubject, createSession } = makeService(
      { user: eligibleUser() },
    );

    const result = await service.socialLogin(input);

    expect(result).toEqual({
      userId: 'existing-user-1',
      sessionToken: 'plaintext-token',
      sessionExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      errors: [],
    });
    expect(findBySocialProviderSubject).toHaveBeenCalledWith(
      AuthProvider.GOOGLE,
      'google-subject-123',
    );
    expect(createSession).toHaveBeenCalledWith({ userId: 'existing-user-1' });
  });

  it('logs in a returning, eligible (APPROVED) social user', async () => {
    const { service } = makeService({
      user: eligibleUser({ accountStatus: UserAccountStatus.APPROVED }),
    });

    const result = await service.socialLogin(input);

    expect(result.userId).toBe('existing-user-1');
  });

  it('rejects with AUTHENTICATION_FAILED for an unknown social identity, never creating a session or an account', async () => {
    const { service, createSession } = makeService({ user: null });

    await expect(service.socialLogin(input)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      message: 'Authentication failed.',
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.PENDING_APPROVAL,
    UserAccountStatus.REJECTED,
  ])(
    'rejects with AUTHENTICATION_FAILED for an existing but ineligible status %s, never creating a session',
    async (accountStatus) => {
      const { service, createSession } = makeService({
        user: eligibleUser({ accountStatus }),
      });

      await expect(service.socialLogin(input)).rejects.toMatchObject({
        code: 'AUTHENTICATION_FAILED',
      });
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it("normalizes ANY validate() failure (including the adapter's own SOCIAL_LOGIN_FAILED) to AUTHENTICATION_FAILED, never creating a session", async () => {
    const { service, createSession } = makeService({
      validateError: new DomainException(
        'SOCIAL_LOGIN_FAILED',
        'Social login failed: the identity token could not be validated.',
      ),
    });

    await expect(service.socialLogin(input)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      message: 'Authentication failed.',
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('normalizes a plain thrown Error (e.g. token parsing failure) to AUTHENTICATION_FAILED as well', async () => {
    const { service, createSession } = makeService({
      validateError: new Error('malformed token'),
    });

    await expect(service.socialLogin(input)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('all thrown failures are DomainException instances', async () => {
    const { service } = makeService({ user: null });
    await expect(service.socialLogin(input)).rejects.toBeInstanceOf(
      DomainException,
    );
  });
});
