import { Injectable, Logger } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { SessionPort } from '../ports/session.port';
import { SocialProvider } from '../enums/social-provider.enum';
import { SocialLoginInput } from '../models/social-login-input.model';
import { LoginPayload } from '../models/login-payload.model';
import { UsersRepository } from '../../users/users.repository';
import { authenticationFailed } from '../errors/authentication-failed.error';
import { isLoginEligibleStatus } from './login-eligibility.util';
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
 * Orchestrates `socialLogin` (GOS-7 — rewritten in place from GOS-22's
 * auto-provisioning version, which was never committed; see the GOS-7 plan
 * for the confirmed rationale). Validates the identity token, then logs in
 * an EXISTING, eligible account only — it NEVER creates a new account.
 *
 * Product gap left by this change, flagged explicitly rather than resolved
 * silently: `UsersRepository.createSocialUser` now has no caller anywhere
 * in the codebase — there is currently no path in the product to create a
 * new Google/Apple account. This is a finding to escalate to Product, not
 * something this story decides.
 *
 * Every failure — invalid/expired token, unknown social identity, an
 * existing but ineligible account status — collapses to the exact same
 * `authenticationFailed()` result as `LoginService`, via the one shared
 * factory. Never reveals which case occurred.
 */
@Injectable()
export class SocialLoginService {
  private readonly logger = new Logger(SocialLoginService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly socialIdentityValidationService: SocialIdentityValidationService,
    private readonly sessionPort: SessionPort,
  ) {}

  async socialLogin(input: SocialLoginInput): Promise<LoginPayload> {
    let identity: Awaited<
      ReturnType<SocialIdentityValidationService['validate']>
    >;
    try {
      identity = await this.socialIdentityValidationService.validate(
        input.provider,
        input.identityToken,
      );
    } catch {
      // Normalizes ANY validation failure — including the adapter's own
      // internal SOCIAL_LOGIN_FAILED DomainException — to the single
      // shared authentication-failure result. The underlying error is
      // deliberately never re-thrown or logged with detail here (the
      // adapter itself already logs a safe, detail-free warning).
      this.logAttempt('failure', 'token_validation_failed');
      throw authenticationFailed();
    }

    const authProvider = SOCIAL_PROVIDER_TO_AUTH_PROVIDER[input.provider];
    const user = await this.usersRepository.findBySocialProviderSubject(
      authProvider,
      identity.subject,
    );

    if (!user || !isLoginEligibleStatus(user.accountStatus)) {
      this.logAttempt(
        'failure',
        user ? 'ineligible_status' : 'unknown_identity',
      );
      throw authenticationFailed();
    }

    const session = await this.sessionPort.createSession({ userId: user.id });

    this.logAttempt('success');
    return {
      userId: user.id,
      sessionToken: session.sessionToken,
      sessionExpiresAt: session.expiresAt,
      errors: [],
    };
  }

  private logAttempt(
    outcome: 'success' | 'failure',
    failureReason?: string,
  ): void {
    this.logger.log({
      event: 'social_login_attempt',
      outcome,
      ...(failureReason ? { failureReason } : {}),
    });
  }
}
