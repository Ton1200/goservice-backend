import { SocialProvider } from '../enums/social-provider.enum';

/**
 * JWKS/issuer settings needed to verify one provider's tokens. Deliberately
 * does NOT include `audience` (GOS-30/31/32 Slice 2 change): the expected
 * `aud` claim is now the DECRYPTED `PlatformCredential` value for
 * `customer.social-login.<provider>.client-id`, read at request time via
 * `PlatformCredentialPort` — see
 * `../adapters/jose-social-identity-validation.adapter.ts`. `jwksUri`/
 * `issuer` stay static/hardcoded (real, well-known provider endpoints —
 * never operator-configurable, unlike the client id).
 */
export interface SocialAuthProviderSettings {
  jwksUri: string;
  issuer: string;
}

export type SocialAuthProviderConfigMap = Record<
  SocialProvider,
  SocialAuthProviderSettings
>;

/**
 * DI token for the provider -> {jwksUri, issuer} config map consumed by
 * `JoseSocialIdentityValidationAdapter`. Wired to the real Google/Apple
 * endpoints in `AuthModule` (see `buildDefaultSocialAuthProviderConfig`
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
 * Builds the real, production Google/Apple provider config — just the
 * static jwksUri/issuer pair per provider. No longer takes any client-id
 * parameters (GOS-30/31/32 Slice 2): those are resolved per-request from
 * `PlatformCredentialPort` instead, not baked into this map at app-startup
 * time — see this file's header comment.
 */
export function buildDefaultSocialAuthProviderConfig(): SocialAuthProviderConfigMap {
  return {
    [SocialProvider.GOOGLE]: {
      jwksUri: GOOGLE_JWKS_URI,
      issuer: GOOGLE_ISSUER,
    },
    [SocialProvider.APPLE]: {
      jwksUri: APPLE_JWKS_URI,
      issuer: APPLE_ISSUER,
    },
  };
}
