import { UserAccountStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { SessionPort } from '../ports/session.port';
import { LoginInput } from '../models/login-input.model';
import { SocialLoginInput } from '../models/social-login-input.model';
import { UsersRepository } from '../../users/users.repository';
import { SocialIdentityValidationService } from './social-identity-validation.service';
import { LoginService } from './login.service';
import { SocialLoginService } from './social-login.service';

/**
 * Explicit "single result" regression test (GOS-7): `login` and
 * `socialLogin` must produce a byte-identical `{ code, message }` pair for
 * EVERY failure mode — not merely by convention, but because both services
 * call the one shared `authenticationFailed()` factory. This asserts deep
 * equality across every documented failure variant, rather than trusting
 * each service's own spec to individually get the shape right.
 */
describe('login/socialLogin authentication-failure parity', () => {
  const EXPECTED_FAILURE = {
    code: 'AUTHENTICATION_FAILED',
    message: 'Authentication failed.',
  };

  async function captureFailure(
    promise: Promise<unknown>,
  ): Promise<{ code: string; message: string }> {
    try {
      await promise;
      throw new Error('expected the promise to reject with a DomainException');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainException);
      const domainError = error as DomainException;
      return { code: domainError.code, message: domainError.message };
    }
  }

  function makeLoginService(overrides: {
    user?: unknown;
    passwordMatches?: boolean;
  }): LoginService {
    const usersRepository = {
      findByEmail: jest.fn().mockResolvedValue(overrides.user ?? null),
    } as unknown as UsersRepository;
    const passwordHasher = {
      hash: jest.fn().mockResolvedValue('decoy-hash'),
      verify: jest.fn().mockResolvedValue(overrides.passwordMatches ?? false),
    } as unknown as PasswordHasherPort;
    const sessionPort = {
      createSession: jest.fn(),
    } as unknown as SessionPort;
    return new LoginService(usersRepository, passwordHasher, sessionPort);
  }

  function makeSocialLoginService(overrides: {
    user?: unknown;
    validateError?: unknown;
  }): SocialLoginService {
    const usersRepository = {
      findBySocialProviderSubject: jest
        .fn()
        .mockResolvedValue(overrides.user ?? null),
    } as unknown as UsersRepository;
    const socialIdentityValidationService = {
      validate: overrides.validateError
        ? jest.fn().mockRejectedValue(overrides.validateError)
        : jest.fn().mockResolvedValue({
            subject: 'google-subject-123',
            email: 'jane@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
          }),
    } as unknown as SocialIdentityValidationService;
    const sessionPort = {
      createSession: jest.fn(),
    } as unknown as SessionPort;
    return new SocialLoginService(
      usersRepository,
      socialIdentityValidationService,
      sessionPort,
    );
  }

  it('is byte-identical across every login and socialLogin failure variant', async () => {
    const loginInput: LoginInput = {
      email: 'jane@example.com',
      password: 'wrong-password',
    };
    const socialInput: SocialLoginInput = {
      provider: SocialProvider.GOOGLE,
      identityToken: 'token',
    };

    const failures = await Promise.all([
      // login: unknown email
      captureFailure(makeLoginService({ user: null }).login(loginInput)),
      // login: wrong password
      captureFailure(
        makeLoginService({
          user: {
            passwordHash: 'h',
            accountStatus: UserAccountStatus.EMAIL_VERIFIED,
          },
          passwordMatches: false,
        }).login(loginInput),
      ),
      // login: social-only account (no passwordHash)
      captureFailure(
        makeLoginService({
          user: {
            passwordHash: null,
            accountStatus: UserAccountStatus.EMAIL_VERIFIED,
          },
          passwordMatches: true,
        }).login(loginInput),
      ),
      // login: ineligible status
      captureFailure(
        makeLoginService({
          user: {
            passwordHash: 'h',
            accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
          },
          passwordMatches: true,
        }).login(loginInput),
      ),
      // socialLogin: unknown identity
      captureFailure(
        makeSocialLoginService({ user: null }).socialLogin(socialInput),
      ),
      // socialLogin: existing but ineligible (REJECTED)
      captureFailure(
        makeSocialLoginService({
          user: { id: 'u1', accountStatus: UserAccountStatus.REJECTED },
        }).socialLogin(socialInput),
      ),
      // socialLogin: token validation throws
      captureFailure(
        makeSocialLoginService({
          validateError: new Error('token invalid'),
        }).socialLogin(socialInput),
      ),
      // socialLogin: token validation throws the adapter's own internal code
      captureFailure(
        makeSocialLoginService({
          validateError: new DomainException(
            'SOCIAL_LOGIN_FAILED',
            'Social login failed: the identity token could not be validated.',
          ),
        }).socialLogin(socialInput),
      ),
    ]);

    for (const failure of failures) {
      expect(failure).toEqual(EXPECTED_FAILURE);
    }
  });
});
