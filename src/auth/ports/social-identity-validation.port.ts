import { SocialProvider } from '../enums/social-provider.enum';

/** Claims extracted from a validated social identity token. */
export interface ValidatedSocialIdentity {
  /** The provider's `sub` claim — stable per-user identifier. */
  subject: string;
  email: string;
  /** Apple often omits name claims after the first authorization. */
  firstName: string | null;
  lastName: string | null;
}

/**
 * Abstraction over verifying a social identity token (Google/Apple),
 * decoupling `SocialLoginService` from the concrete `jose`-based JWKS
 * verification in `adapters/jose-social-identity-validation.adapter.ts`.
 *
 * Any validation failure (bad signature, wrong issuer/audience, expired,
 * JWKS fetch failure) must be surfaced as one generic failure — see the
 * adapter for how that collapsing happens.
 */
export abstract class SocialIdentityValidationPort {
  abstract validate(
    provider: SocialProvider,
    identityToken: string,
  ): Promise<ValidatedSocialIdentity>;
}
