import { AuthProvider, UserAccountStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';
import { SessionPort } from '../ports/session.port';
import { UsersRepository } from '../../users/users.repository';
import { SocialIdentityValidationService } from './social-identity-validation.service';
import { SocialLoginService } from './social-login.service';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';

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
      existingByEmail?: unknown;
      validateError?: unknown;
      featureFlagEnabled?: boolean;
    } = {},
  ) {
    const findBySocialProviderSubject = jest
      .fn()
      .mockResolvedValue(options.user ?? null);
    const findByEmail = jest
      .fn()
      .mockResolvedValue(options.existingByEmail ?? null);
    const createSocialUser = jest.fn().mockResolvedValue({
      id: 'new-user-1',
      accountStatus: UserAccountStatus.EMAIL_VERIFIED,
    });
    const usersRepository = {
      findBySocialProviderSubject,
      findByEmail,
      createSocialUser,
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

    const isEnabled = jest
      .fn()
      .mockResolvedValue(options.featureFlagEnabled ?? true);
    const featureFlagPort = { isEnabled } as unknown as PlatformSettingPort;

    const service = new SocialLoginService(
      usersRepository,
      socialIdentityValidationService,
      sessionPort,
      featureFlagPort,
    );
    return {
      service,
      findBySocialProviderSubject,
      findByEmail,
      createSocialUser,
      validate,
      createSession,
      isEnabled,
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

  it('auto-registers a new account for an unrecognized social identity with a brand-new email, then logs it in', async () => {
    const { service, createSocialUser, createSession } = makeService({
      user: null,
      existingByEmail: null,
    });

    const result = await service.socialLogin(input);

    expect(createSocialUser).toHaveBeenCalledWith({
      authProvider: AuthProvider.GOOGLE,
      socialProviderSubject: 'google-subject-123',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(createSession).toHaveBeenCalledWith({ userId: 'new-user-1' });
    expect(result).toEqual({
      userId: 'new-user-1',
      sessionToken: 'plaintext-token',
      sessionExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      errors: [],
    });
  });

  it('rejects with AUTHENTICATION_FAILED when an unrecognized social identity has an email that already belongs to another account, never creating a duplicate account or a session', async () => {
    const { service, createSocialUser, createSession } = makeService({
      user: null,
      existingByEmail: {
        id: 'other-user-1',
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });

    await expect(service.socialLogin(input)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      message: 'Authentication failed.',
    });
    expect(createSocialUser).not.toHaveBeenCalled();
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
    const { service } = makeService({
      user: null,
      existingByEmail: { id: 'other-user-1' },
    });
    await expect(service.socialLogin(input)).rejects.toBeInstanceOf(
      DomainException,
    );
  });

  describe('PlatformCredentialPort gate (GOS-30/31/32 Slice 2 reference case)', () => {
    it('lets SOCIAL_LOGIN_MISCONFIGURED escape UN-normalized (NOT collapsed into AUTHENTICATION_FAILED) when validate() throws it', async () => {
      const { service, createSession } = makeService({
        validateError: new DomainException(
          'SOCIAL_LOGIN_MISCONFIGURED',
          'Google sign-in is not fully configured yet.',
        ),
      });

      await expect(service.socialLogin(input)).rejects.toMatchObject({
        code: 'SOCIAL_LOGIN_MISCONFIGURED',
        message: 'Google sign-in is not fully configured yet.',
      });
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  describe('FeatureFlagPort gate (GOS-30/31/32 reference case)', () => {
    it('rejects with SOCIAL_LOGIN_DISABLED — NOT AUTHENTICATION_FAILED — when the provider flag is disabled, checked BEFORE token validation', async () => {
      const { service, validate, createSession, isEnabled } = makeService({
        featureFlagEnabled: false,
      });

      await expect(service.socialLogin(input)).rejects.toMatchObject({
        code: 'SOCIAL_LOGIN_DISABLED',
        message: 'Google sign-in is currently disabled.',
      });
      expect(isEnabled).toHaveBeenCalledWith(
        'customer.social-login.google.enabled',
      );
      // Never even reaches token validation once the flag is disabled.
      expect(validate).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    });

    it('checks the APPLE-specific flag key and message for the APPLE provider', async () => {
      const { service, isEnabled } = makeService({
        featureFlagEnabled: false,
      });

      await expect(
        service.socialLogin({
          provider: SocialProvider.APPLE,
          identityToken: 'token',
        }),
      ).rejects.toMatchObject({
        code: 'SOCIAL_LOGIN_DISABLED',
        message: 'Apple sign-in is currently disabled.',
      });
      expect(isEnabled).toHaveBeenCalledWith(
        'customer.social-login.apple.enabled',
      );
    });

    it('proceeds normally (reaching token validation) when the flag is enabled', async () => {
      const { service, validate, createSession } = makeService({
        user: eligibleUser(),
        featureFlagEnabled: true,
      });

      await service.socialLogin(input);

      expect(validate).toHaveBeenCalled();
      expect(createSession).toHaveBeenCalled();
    });

    it('SOCIAL_LOGIN_DISABLED is a DomainException instance', async () => {
      const { service } = makeService({ featureFlagEnabled: false });
      await expect(service.socialLogin(input)).rejects.toBeInstanceOf(
        DomainException,
      );
    });
  });
});
