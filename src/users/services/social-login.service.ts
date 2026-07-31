import { Injectable, Logger } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';
import { SocialLoginInput } from '../models/social-login-input.model';
import { LoginPayload } from '../models/login-payload.model';
import { UsersRepository } from '../users.repository';
import { SocialIdentityValidationService } from './social-identity-validation.service';

/**
 * `SocialProvider` (GraphQL-facing) and the Prisma `AuthProvider` enum
 * share their GOOGLE/APPLE values by design — `AuthProvider` additionally
 * has `PASSWORD`, which `SocialProvider` deliberately excludes (a password
 * account can never be the target of `socialLogin`). This is the one
 * explicit mapping point between the two.
 */
const SOCIAL_PROVIDER_TO_AUTH_PROVIDER: Record<SocialProvider, AuthProvider> = {
  [SocialProvider.GOOGLE]: AuthProvider.GOOGLE,
  [SocialProvider.APPLE]: AuthProvider.APPLE,
};

/**
 * Orchestrates `socialLogin` (GOS-22): validates the identity token, then
 * either recognizes a returning social user, rejects an email collision
 * with a different auth method, or provisions a brand-new social account.
 * Never auto-merges accounts across auth methods.
 */
@Injectable()
export class SocialLoginService {
  private readonly logger = new Logger(SocialLoginService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly socialIdentityValidationService: SocialIdentityValidationService,
  ) {}

  async socialLogin(input: SocialLoginInput): Promise<LoginPayload> {
    const identity = await this.socialIdentityValidationService.validate(
      input.provider,
      input.identityToken,
    );

    const authProvider = SOCIAL_PROVIDER_TO_AUTH_PROVIDER[input.provider];

    const returningUser =
      await this.usersRepository.findBySocialProviderSubject(
        authProvider,
        identity.subject,
      );
    if (returningUser) {
      this.logger.log({ event: 'social_login_attempt', outcome: 'recognized' });
      return { userId: returningUser.id, errors: [] };
    }

    const collidingUser = await this.usersRepository.findByEmail(
      identity.email,
    );
    if (collidingUser) {
      // Could be a password account, or a social account under a
      // different provider (or the same provider with a different, e.g.
      // rotated, subject) — either way, never auto-merge accounts.
      this.logger.log({
        event: 'social_login_attempt',
        outcome: 'failure',
        failureReason: 'email_collision',
      });
      throw new DomainException(
        'SOCIAL_LOGIN_FAILED',
        'Social login failed: this email is already associated with a different account.',
      );
    }

    const newUser = await this.usersRepository.createSocialUser({
      authProvider,
      socialProviderSubject: identity.subject,
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
    });

    this.logger.log({
      event: 'social_login_attempt',
      outcome: 'new_account_created',
    });
    return { userId: newUser.id, errors: [] };
  }
}
