import { Injectable, Logger } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { SessionPort } from '../ports/session.port';
import { SocialProvider } from '../enums/social-provider.enum';
import { SocialLoginInput } from '../models/social-login-input.model';
import { LoginPayload } from '../models/login-payload.model';
import { UsersRepository } from '../../users/users.repository';
import { authenticationFailed } from '../errors/authentication-failed.error';
import { socialLoginDisabled } from '../errors/social-login-disabled.error';
import { isLoginEligibleStatus } from './login-eligibility.util';
import { SocialIdentityValidationService } from './social-identity-validation.service';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';

/**
 * Maps a `SocialProvider` to the `PlatformSetting.key` gating it — the
 * reference case for `PlatformSettingPort.isEnabled`'s cross-boundary read
 * (GOS-30/31/32 plan, "The `FeatureFlagPort` cross-boundary read" — Slice 3
 * consolidated `FeatureFlagPort`/`PlatformCredentialPort` into one
 * `PlatformSettingPort`). Both keys are seeded `value: 'true'` by default —
 * see `prisma/seed.ts`. Renamed to the dot-namespaced path convention in
 * Slice 2 (was `social-login.google`/`social-login.apple`) — see
 * `prisma/seed.ts`'s comment for the full rationale.
 */
const FEATURE_FLAG_KEY_BY_PROVIDER: Record<SocialProvider, string> = {
  [SocialProvider.GOOGLE]: 'customer.social-login.google.enabled',
  [SocialProvider.APPLE]: 'customer.social-login.apple.enabled',
};

/** `DomainException.code` values from `validate()` that must escape
 * un-normalized rather than collapse into the generic
 * `authenticationFailed()` result below — see `SOCIAL_LOGIN_MISCONFIGURED`'s
 * own doc comment (`../errors/social-login-misconfigured.error.ts`) for why
 * this is a legitimate-to-disclose condition, not a credential-guessing
 * signal.
 */
const PASSTHROUGH_VALIDATION_ERROR_CODES = new Set([
  'SOCIAL_LOGIN_MISCONFIGURED',
]);

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
 * Orchestrates `socialLogin`. Validates the identity token, then either
 * logs in an existing account (matched by `(authProvider, subject)`) or
 * auto-registers a brand new one the first time a given social identity is
 * seen — reactivated (GOS-7/8 follow-up, 2026-08-03) at explicit request
 * of Product, which resolved the product gap that GOS-7 had originally
 * left open (`UsersRepository.createSocialUser` used to have no caller
 * anywhere in the codebase).
 *
 * The one safeguard that makes auto-registration safe: before creating a
 * new account for an unrecognized `(authProvider, subject)`, this service
 * checks whether the identity's email already belongs to ANY existing
 * account (password or a different social provider). If it does, the
 * attempt is rejected rather than silently merged into that account —
 * accounts are never auto-merged by email. Only when no account exists at
 * all for that email does `UsersRepository.createSocialUser` get called.
 *
 * Every failure — invalid/expired token, an email already used by another
 * account, an existing but ineligible account status — collapses to the
 * exact same `authenticationFailed()` result as `LoginService`, via the one
 * shared factory. Never reveals which case occurred.
 */
@Injectable()
export class SocialLoginService {
  private readonly logger = new Logger(SocialLoginService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly socialIdentityValidationService: SocialIdentityValidationService,
    private readonly sessionPort: SessionPort,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async socialLogin(input: SocialLoginInput): Promise<LoginPayload> {
    // Checked BEFORE token validation/the anti-enumeration
    // authenticationFailed() path — per GOS-32's acceptance criterion, a
    // disabled provider must surface as its own distinct
    // SOCIAL_LOGIN_DISABLED error, never collapsed into the generic
    // authentication-failure result.
    const featureFlagKey = FEATURE_FLAG_KEY_BY_PROVIDER[input.provider];
    const providerEnabled =
      await this.platformSettingPort.isEnabled(featureFlagKey);
    if (!providerEnabled) {
      this.logAttempt('failure', 'provider_disabled');
      throw socialLoginDisabled(input.provider);
    }

    let identity: Awaited<
      ReturnType<SocialIdentityValidationService['validate']>
    >;
    try {
      identity = await this.socialIdentityValidationService.validate(
        input.provider,
        input.identityToken,
      );
    } catch (error) {
      // SOCIAL_LOGIN_MISCONFIGURED (GOS-30/31/32 Slice 2) is a deliberate
      // exception to the normalization below: an admin-driven
      // "nobody has configured this provider's credential yet" condition is
      // legitimate to disclose distinctly, same reasoning as the
      // SOCIAL_LOGIN_DISABLED check above — never collapsed into the
      // generic authentication-failure result.
      if (
        error instanceof DomainException &&
        PASSTHROUGH_VALIDATION_ERROR_CODES.has(error.code)
      ) {
        this.logAttempt('failure', 'provider_misconfigured');
        throw error;
      }
      // Normalizes every OTHER validation failure — including the
      // adapter's own internal SOCIAL_LOGIN_FAILED DomainException — to the
      // single shared authentication-failure result. The underlying error
      // is deliberately never re-thrown or logged with detail here (the
      // adapter itself already logs a safe, detail-free warning).
      this.logAttempt('failure', 'token_validation_failed');
      throw authenticationFailed();
    }

    const authProvider = SOCIAL_PROVIDER_TO_AUTH_PROVIDER[input.provider];
    let user = await this.usersRepository.findBySocialProviderSubject(
      authProvider,
      identity.subject,
    );

    if (!user) {
      // Never auto-merge accounts: if this email already belongs to any
      // existing account (password or another social provider), reject
      // rather than silently attaching this identity to it.
      const existingByEmail = await this.usersRepository.findByEmail(
        identity.email,
      );
      if (existingByEmail) {
        this.logAttempt('failure', 'email_collision');
        throw authenticationFailed();
      }

      user = await this.usersRepository.createSocialUser({
        authProvider,
        socialProviderSubject: identity.subject,
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
      });
    }

    if (!isLoginEligibleStatus(user.accountStatus)) {
      this.logAttempt('failure', 'ineligible_status');
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
