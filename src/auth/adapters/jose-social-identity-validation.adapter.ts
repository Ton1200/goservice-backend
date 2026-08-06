import { Inject, Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';
import { SOCIAL_AUTH_PROVIDER_CONFIG } from '../config/social-auth-provider.config';
import type { SocialAuthProviderConfigMap } from '../config/social-auth-provider.config';
import {
  SocialIdentityValidationPort,
  ValidatedSocialIdentity,
} from '../ports/social-identity-validation.port';

/**
 * Verifies Google/Apple identity tokens via `jose`'s remote-JWKS
 * verification (RS256 signature + `iss`/`aud`/`exp`). ANY failure (bad
 * signature, wrong issuer/audience, expired token, JWKS fetch failure)
 * collapses to a single generic `SOCIAL_LOGIN_FAILED` `DomainException` —
 * never leaking which specific check failed, per GOS-22's security
 * requirements.
 *
 * The provider -> {jwksUri, issuer, audience} map is injected (see
 * `SOCIAL_AUTH_PROVIDER_CONFIG`) rather than hardcoded, so tests can
 * substitute a locally-served JWKS without touching this class or the
 * production wiring in `AuthModule`.
 */
@Injectable()
export class JoseSocialIdentityValidationAdapter implements SocialIdentityValidationPort {
  private readonly logger = new Logger(
    JoseSocialIdentityValidationAdapter.name,
  );

  // Cached per JWKS URI (jose's own remote-JWKS helper caches fetched keys
  // internally; this outer cache just avoids re-creating that helper, and
  // its remote HTTP cache, on every single call).
  private readonly jwksCache = new Map<string, JWTVerifyGetKey>();

  constructor(
    @Inject(SOCIAL_AUTH_PROVIDER_CONFIG)
    private readonly providerConfig: SocialAuthProviderConfigMap,
  ) {}

  async validate(
    provider: SocialProvider,
    identityToken: string,
  ): Promise<ValidatedSocialIdentity> {
    try {
      const settings = this.providerConfig[provider];
      const jwks = this.getOrCreateJwks(settings.jwksUri);

      const { payload } = await jwtVerify(identityToken, jwks, {
        issuer: settings.issuer,
        audience: settings.audience,
      });

      const subject = payload.sub;
      const email = payload.email;
      if (typeof subject !== 'string' || typeof email !== 'string') {
        throw new Error('Missing required sub/email claims.');
      }

      return {
        subject,
        email,
        firstName: this.stringClaimOrNull(payload, 'given_name'),
        lastName: this.stringClaimOrNull(payload, 'family_name'),
      };
    } catch {
      // Deliberately no error detail logged here — even the error's own
      // message could hint at the specific failure reason (e.g. "signature
      // verification failed" vs. "aud mismatch"). Only a short prefix of
      // the token is safe to correlate by; never the full token.
      this.logger.warn({
        event: 'social_login_token_validation_failed',
        provider,
        tokenPrefix: identityToken.slice(0, 8),
      });
      throw new DomainException(
        'SOCIAL_LOGIN_FAILED',
        'Social login failed: the identity token could not be validated.',
      );
    }
  }

  private getOrCreateJwks(jwksUri: string): JWTVerifyGetKey {
    const cached = this.jwksCache.get(jwksUri);
    if (cached) {
      return cached;
    }
    const jwks = createRemoteJWKSet(new URL(jwksUri));
    this.jwksCache.set(jwksUri, jwks);
    return jwks;
  }

  private stringClaimOrNull(
    payload: Record<string, unknown>,
    claim: string,
  ): string | null {
    const value = payload[claim];
    return typeof value === 'string' ? value : null;
  }
}
