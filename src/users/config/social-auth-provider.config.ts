import { SocialProvider } from '../enums/social-provider.enum';

/** JWKS/issuer/audience settings needed to verify one provider's tokens. */
export interface SocialAuthProviderSettings {
  jwksUri: string;
  issuer: string;
  /** Expected `aud` claim — the configured client id for this provider. */
  audience: string;
}

export type SocialAuthProviderConfigMap = Record<
  SocialProvider,
  SocialAuthProviderSettings
>;

/**
 * DI token for the provider -> {jwksUri, issuer, audience} config map
 * consumed by `JoseSocialIdentityValidationAdapter`. Wired to the real
 * Google/Apple endpoints in `UsersModule` (see `buildDefaultSocialAuthProviderConfig`
 * below); tests override this provider to point at a locally-served JWKS
 * instead of hitting real Google/Apple infrastructure — this is the
 * "designed for testability" seam called out in the GOS-22 plan.
 */
export const SOCIAL_AUTH_PROVIDER_CONFIG = Symbol(
  'SOCIAL_AUTH_PROVIDER_CONFIG',
);

const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUER = 'https://accounts.google.com';
const APPLE_JWKS_URI = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

/**
 * Builds the real, production Google/Apple provider config from the
 * configured client ids. `googleClientId`/`appleClientId` are expected to
 * be non-empty in any environment where `socialLogin` is actually called
 * (enforced at startup by `env-validation.schema.ts`).
 */
export function buildDefaultSocialAuthProviderConfig(
  googleClientId: string | undefined,
  appleClientId: string | undefined,
): SocialAuthProviderConfigMap {
  return {
    [SocialProvider.GOOGLE]: {
      jwksUri: GOOGLE_JWKS_URI,
      issuer: GOOGLE_ISSUER,
      audience: googleClientId ?? '',
    },
    [SocialProvider.APPLE]: {
      jwksUri: APPLE_JWKS_URI,
      issuer: APPLE_ISSUER,
      audience: appleClientId ?? '',
    },
  };
}
