import { AuthProvider } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';
import { UsersRepository } from '../users.repository';
import { SocialIdentityValidationService } from './social-identity-validation.service';
import { SocialLoginService } from './social-login.service';

describe('SocialLoginService', () => {
  const VALIDATED_IDENTITY = {
    subject: 'google-subject-123',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
  };

  function makeService(options: {
    returningUser?: unknown;
    collidingUser?: unknown;
  }) {
    const findBySocialProviderSubject = jest
      .fn()
      .mockResolvedValue(options.returningUser ?? null);
    const findByEmail = jest
      .fn()
      .mockResolvedValue(options.collidingUser ?? null);
    const createSocialUser = jest.fn().mockResolvedValue({ id: 'new-user-1' });
    const usersRepository = {
      findBySocialProviderSubject,
      findByEmail,
      createSocialUser,
    } as unknown as UsersRepository;

    const validate = jest.fn().mockResolvedValue(VALIDATED_IDENTITY);
    const socialIdentityValidationService = {
      validate,
    } as unknown as SocialIdentityValidationService;

    const service = new SocialLoginService(
      usersRepository,
      socialIdentityValidationService,
    );
    return {
      service,
      findBySocialProviderSubject,
      findByEmail,
      createSocialUser,
    };
  }

  const input = { provider: SocialProvider.GOOGLE, identityToken: 'token' };

  it('recognizes a returning social user via (authProvider, subject) fast path', async () => {
    const { service, findBySocialProviderSubject } = makeService({
      returningUser: { id: 'existing-user-1' },
    });

    const result = await service.socialLogin(input);

    expect(result).toEqual({ userId: 'existing-user-1', errors: [] });
    expect(findBySocialProviderSubject).toHaveBeenCalledWith(
      AuthProvider.GOOGLE,
      'google-subject-123',
    );
  });

  it('creates a new social user (EMAIL_VERIFIED at birth) when genuinely new', async () => {
    const { service, createSocialUser } = makeService({});

    const result = await service.socialLogin(input);

    expect(result).toEqual({ userId: 'new-user-1', errors: [] });
    expect(createSocialUser).toHaveBeenCalledWith({
      authProvider: AuthProvider.GOOGLE,
      socialProviderSubject: 'google-subject-123',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    });
  });

  it('rejects with SOCIAL_LOGIN_FAILED on an email collision with a different account, never auto-merging', async () => {
    const { service, createSocialUser } = makeService({
      collidingUser: { id: 'other-user' },
    });

    await expect(service.socialLogin(input)).rejects.toMatchObject({
      code: 'SOCIAL_LOGIN_FAILED',
    });
    expect(createSocialUser).not.toHaveBeenCalled();
  });

  it('collision failures are DomainException instances', async () => {
    const { service } = makeService({ collidingUser: { id: 'other-user' } });

    await expect(service.socialLogin(input)).rejects.toBeInstanceOf(
      DomainException,
    );
  });
});
