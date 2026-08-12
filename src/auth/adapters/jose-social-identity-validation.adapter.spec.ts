import { DomainException } from '../../common/errors/domain-exception';
import { SocialProvider } from '../enums/social-provider.enum';
import type { SocialAuthProviderConfigMap } from '../config/social-auth-provider.config';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { JoseSocialIdentityValidationAdapter } from './jose-social-identity-validation.adapter';

describe('JoseSocialIdentityValidationAdapter', () => {
  function makeAdapter(getValue: jest.Mock) {
    const providerConfig: SocialAuthProviderConfigMap = {
      [SocialProvider.GOOGLE]: {
        jwksUri: 'https://example.com/jwks',
        issuer: 'https://example.com',
      },
      [SocialProvider.APPLE]: {
        jwksUri: 'https://example.com/jwks',
        issuer: 'https://example.com',
      },
    };
    const platformSettingPort = {
      getValue,
    } as unknown as PlatformSettingPort;

    return new JoseSocialIdentityValidationAdapter(
      providerConfig,
      platformSettingPort,
    );
  }

  describe('PlatformSettingPort gate (GOS-30/31/32 Slice 3 reference case)', () => {
    it('throws SOCIAL_LOGIN_MISCONFIGURED — NOT SOCIAL_LOGIN_FAILED — when no client-id credential is configured, checked BEFORE JWT verification', async () => {
      const getValue = jest.fn().mockResolvedValue(null);
      const adapter = makeAdapter(getValue);

      await expect(
        adapter.validate(SocialProvider.GOOGLE, 'any-token-value'),
      ).rejects.toMatchObject({
        code: 'SOCIAL_LOGIN_MISCONFIGURED',
        message: 'Google sign-in is not fully configured yet.',
      });
      expect(getValue).toHaveBeenCalledWith(
        'customer.social-login.google.client-id',
      );
    });

    it('looks up the APPLE-specific credential key for the APPLE provider', async () => {
      const getValue = jest.fn().mockResolvedValue(null);
      const adapter = makeAdapter(getValue);

      await expect(
        adapter.validate(SocialProvider.APPLE, 'any-token-value'),
      ).rejects.toMatchObject({ code: 'SOCIAL_LOGIN_MISCONFIGURED' });
      expect(getValue).toHaveBeenCalledWith(
        'customer.social-login.apple.client-id',
      );
    });

    it('SOCIAL_LOGIN_MISCONFIGURED is a DomainException instance', async () => {
      const getValue = jest.fn().mockResolvedValue(null);
      const adapter = makeAdapter(getValue);

      await expect(
        adapter.validate(SocialProvider.GOOGLE, 'any-token-value'),
      ).rejects.toBeInstanceOf(DomainException);
    });

    it('proceeds to (and fails at) JWT verification — not SOCIAL_LOGIN_MISCONFIGURED — once a credential is configured', async () => {
      const getValue = jest.fn().mockResolvedValue('some-client-id');
      const adapter = makeAdapter(getValue);

      // No real JWKS server here, so this token fails real jwtVerify — but
      // the point of this test is that it fails with SOCIAL_LOGIN_FAILED
      // (the generic catch-all), NOT SOCIAL_LOGIN_MISCONFIGURED, proving the
      // credential check passed and execution reached jwtVerify.
      await expect(
        adapter.validate(SocialProvider.GOOGLE, 'not-a-real-jwt'),
      ).rejects.toMatchObject({ code: 'SOCIAL_LOGIN_FAILED' });
    });
  });
});
