import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { SocialProvider } from '../src/auth/enums/social-provider.enum';
import type { SocialAuthProviderConfigMap } from '../src/auth/config/social-auth-provider.config';
import { CredentialEncryptionPort } from '../src/platform-admin/platform-settings/ports/credential-encryption.port';
import { PrismaService } from '../src/prisma/prisma.service';
import type { AppConfig } from '../src/config/configuration';
import {
  cleanPlatformSettingsData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';
import { LocalJwksServer } from './support/local-jwks-server';

const SOCIAL_LOGIN_MUTATION = `
  mutation SocialLogin($input: SocialLoginInput!) {
    socialLogin(input: $input) {
      userId
      sessionToken
      sessionExpiresAt
      errors { code message }
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface SocialLoginResponseBody {
  data: {
    socialLogin: {
      userId: string;
      sessionToken: string;
      sessionExpiresAt: string;
      errors: { code: string; message: string }[];
    };
  } | null;
  errors?: GraphQLErrorEntry[];
}

const ISSUER = 'https://test-issuer.example.com';
const AUDIENCE = 'test-google-client-id';

const GOOGLE_CLIENT_ID_KEY = 'customer.social-login.google.client-id';
const APPLE_CLIENT_ID_KEY = 'customer.social-login.apple.client-id';

/**
 * These tests validate `socialLogin` end-to-end against a locally-served
 * JWKS with a synthetic RS256-signed JWT (via `jose`'s own key-generation
 * helpers) — a substitute for real Google/Apple tokens, which cannot be
 * obtained in this environment. `SOCIAL_AUTH_PROVIDER_CONFIG` is overridden
 * to point at this local server instead of the real provider endpoints
 * (jwksUri/issuer only — see that config's own header comment for why
 * `audience` no longer lives there).
 *
 * The expected `aud` value itself (GOS-30/31/32 Slice 2) now comes from a
 * real, encrypted `PlatformSetting` row — seeded below via the app's own
 * `CredentialEncryptionPort` instance (never a hand-rolled/duplicated
 * encryption path), proving the real `PlatformSettingPort.getValue` round
 * trip through its decrypt branch, not a mocked substitute. (An OAuth
 * client-id is actually a PUBLIC identifier, not a secret — see
 * `admin-panel/js/settings.js`'s `KNOWN_SETTING_SLOTS` — so this suite's use
 * of the ENCRYPTED shape here is a deliberate choice to also exercise
 * `getValue`'s decrypt branch specifically, not a claim that client-id
 * SHOULD be encrypted in a real environment.)
 *
 * Reactivated auto-registration (2026-08-03, GOS-7/8 follow-up): on an
 * unrecognized `(authProvider, subject)`, `socialLogin` now creates a new
 * account UNLESS the identity's email already belongs to another existing
 * account, in which case it fails rather than auto-merging. Every failure
 * surfaces the same `AUTHENTICATION_FAILED` result `login` uses (not the
 * old `SOCIAL_LOGIN_FAILED` code).
 */
describe('GraphQL socialLogin (e2e, synthetic JWKS substitute for real Google/Apple)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwksServer: LocalJwksServer;

  beforeAll(async () => {
    jwksServer = new LocalJwksServer();
    const { jwksUri } = await jwksServer.start();

    const socialAuthProviderConfig: SocialAuthProviderConfigMap = {
      [SocialProvider.GOOGLE]: { jwksUri, issuer: ISSUER },
      [SocialProvider.APPLE]: { jwksUri, issuer: ISSUER },
    };

    const ctx = await createTestApp({ socialAuthProviderConfig });
    app = ctx.app;
    prisma = ctx.prisma;

    // Seeds the two client-id PlatformSetting rows (isEncrypted: true) this
    // whole suite's baseline expects to exist (mirrors how the
    // `social-login.*` boolean settings below are the seeded, always-there
    // baseline) — real encryption, via the app's own bound
    // CredentialEncryptionPort instance.
    const credentialEncryptionPort = app.get(CredentialEncryptionPort);
    await upsertClientIdCredential(
      credentialEncryptionPort,
      GOOGLE_CLIENT_ID_KEY,
      'GOOGLE',
      AUDIENCE,
    );
    await upsertClientIdCredential(
      credentialEncryptionPort,
      APPLE_CLIENT_ID_KEY,
      'APPLE',
      AUDIENCE,
    );
  });

  async function upsertClientIdCredential(
    credentialEncryptionPort: CredentialEncryptionPort,
    key: string,
    provider: string,
    value: string,
  ): Promise<void> {
    const { ciphertext, iv, authTag } = credentialEncryptionPort.encrypt(value);
    const maskedPreview = credentialEncryptionPort.maskedPreview(value);
    await prisma.platformSetting.upsert({
      where: { key },
      // `isEncrypted: true, value: null` are included in `update` (not just
      // `create`) so this helper is idempotent even when the row currently
      // sitting at `key` is NON-encrypted (see the
      // "stored NON-encrypted" test below, which deliberately flips the row
      // the other way) — without this, upserting only the encrypted columns
      // onto an `isEncrypted: false` row (which still carries a non-null
      // `value`) would violate `platform_setting_encrypted_shape_check`.
      update: {
        isEncrypted: true,
        value: null,
        ciphertext,
        iv,
        authTag,
        maskedPreview,
        provider,
      },
      create: {
        key,
        description: `Encrypted client-id credential for ${provider}.`,
        valueType: 'STRING',
        isEncrypted: true,
        provider,
        ciphertext,
        iv,
        authTag,
        maskedPreview,
      },
    });
  }

  afterAll(async () => {
    await cleanUsersData(prisma);
    await cleanPlatformSettingsData(prisma, [
      GOOGLE_CLIENT_ID_KEY,
      APPLE_CLIENT_ID_KEY,
    ]);
    await app.close();
    await jwksServer.stop();
  });

  async function seedSocialUser(
    accountStatus: UserAccountStatus,
  ): Promise<{ subject: string; email: string; userId: string }> {
    const subject = `google-subject-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `social-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        authProvider: AuthProvider.GOOGLE,
        socialProviderSubject: subject,
        accountStatus,
        acceptedTermsAndPrivacy: true,
        passwordHash: null,
      },
    });
    return { subject, email, userId: user.id };
  }

  async function socialLoginRequest(token: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: SOCIAL_LOGIN_MUTATION,
        variables: { input: { provider: 'GOOGLE', identityToken: token } },
      })
      .expect(200);
  }

  it('logs in a pre-seeded, eligible (EMAIL_VERIFIED) social user and creates a real Session row', async () => {
    const { subject, email, userId } = await seedSocialUser(
      UserAccountStatus.EMAIL_VERIFIED,
    );
    const token = await jwksServer.signToken({
      issuer: ISSUER,
      audience: AUDIENCE,
      subject,
      email,
    });

    const response = await socialLoginRequest(token);
    const body = response.body as SocialLoginResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.socialLogin.userId).toBe(userId);
    expect(body.data?.socialLogin.sessionToken).toEqual(
      expect.any(String) as unknown,
    );

    const sessionToken = body.data!.socialLogin.sessionToken;
    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toBe(sessionToken);
  });

  it('logs in a pre-seeded, eligible (APPROVED) social user', async () => {
    const { subject, email, userId } = await seedSocialUser(
      UserAccountStatus.APPROVED,
    );
    const token = await jwksServer.signToken({
      issuer: ISSUER,
      audience: AUDIENCE,
      subject,
      email,
    });

    const response = await socialLoginRequest(token);
    const body = response.body as SocialLoginResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.socialLogin.userId).toBe(userId);
  });

  it('auto-registers a brand-new account for a never-seen social identity, and creates a real Session row', async () => {
    const subject = `google-subject-new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `new-social-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const token = await jwksServer.signToken({
      issuer: ISSUER,
      audience: AUDIENCE,
      subject,
      email,
    });

    const usersBefore = await prisma.user.count();

    const response = await socialLoginRequest(token);
    const body = response.body as SocialLoginResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.socialLogin.userId).toEqual(
      expect.any(String) as unknown,
    );
    expect(body.data?.socialLogin.sessionToken).toEqual(
      expect.any(String) as unknown,
    );

    const usersAfter = await prisma.user.count();
    expect(usersAfter).toBe(usersBefore + 1);

    const userId = body.data!.socialLogin.userId;
    const createdUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    expect(createdUser?.email).toBe(email);
    expect(createdUser?.authProvider).toBe(AuthProvider.GOOGLE);
    expect(createdUser?.socialProviderSubject).toBe(subject);
    expect(createdUser?.accountStatus).toBe(UserAccountStatus.EMAIL_VERIFIED);
    expect(createdUser?.passwordHash).toBeNull();

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);
  });

  it('rejects a never-seen social identity whose email already belongs to an existing account, never creating a second account', async () => {
    const email = `collision-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    await prisma.user.create({
      data: {
        email,
        authProvider: AuthProvider.PASSWORD,
        passwordHash: 'irrelevant-hash-for-this-test',
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
        acceptedTermsAndPrivacy: true,
      },
    });

    const subject = `google-subject-collision-${Date.now()}`;
    const token = await jwksServer.signToken({
      issuer: ISSUER,
      audience: AUDIENCE,
      subject,
      email,
    });

    const usersBefore = await prisma.user.count();

    const response = await socialLoginRequest(token);
    const body = response.body as SocialLoginResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_FAILED');
    expect(body.errors?.[0].message).toBe('Authentication failed.');

    const usersAfter = await prisma.user.count();
    expect(usersAfter).toBe(usersBefore); // no second account created
  });

  it('rejects an invalid/unverifiable token with the same unified AUTHENTICATION_FAILED code (not the old SOCIAL_LOGIN_FAILED)', async () => {
    const response = await socialLoginRequest('not-a-real-jwt-at-all');
    const body = response.body as SocialLoginResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_FAILED');
    expect(body.errors?.[0].message).toBe('Authentication failed.');
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.PENDING_APPROVAL,
    UserAccountStatus.REJECTED,
  ])(
    'rejects an existing but ineligible-status (%s) social account with the same AUTHENTICATION_FAILED result, creating no session',
    async (accountStatus) => {
      const { subject, email, userId } = await seedSocialUser(accountStatus);
      const token = await jwksServer.signToken({
        issuer: ISSUER,
        audience: AUDIENCE,
        subject,
        email,
      });

      const response = await socialLoginRequest(token);
      const body = response.body as SocialLoginResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_FAILED');
      await expect(
        prisma.session.findMany({ where: { userId } }),
      ).resolves.toHaveLength(0);
    },
  );

  /**
   * GOS-30/31/32 reference case, proven at the API layer: a disabled
   * `customer.social-login.google.enabled` `PlatformSetting` (a
   * non-encrypted, public, BOOLEAN row) rejects `socialLogin(GOOGLE, ...)`
   * with the distinct `SOCIAL_LOGIN_DISABLED` code — checked BEFORE token
   * validation, so this fires even for an otherwise-eligible, real
   * account/token. Restores the setting's value to `'true'` afterward (its
   * seeded default — see `prisma/seed.ts`) so this suite never leaks state
   * into other e2e files that rely on it (e.g.
   * `test/admin-platform-settings.e2e-spec.ts` deliberately avoids touching
   * this shared setting for the same reason, in the other direction).
   */
  describe('PlatformSettingPort.isEnabled gate (customer.social-login.google.enabled/customer.social-login.apple.enabled)', () => {
    // `socialLogin` is throttled (10 requests/60s) and every `it` ABOVE this
    // block in this same file already calls it several times with no reset
    // in between (this block's own 2 calls used to just barely fit under
    // that shared budget) — flush the shared Redis-backed throttle counter
    // before EACH test in this block too, same pattern as the
    // `PlatformSettingPort.getValue gate` block further down this file, so
    // this block's own 2 calls never get spuriously rejected by
    // `ThrottlerException` regardless of how many tests run before it
    // (found live: adding one more `it` above this block, GOS-3x follow-up
    // 2026-08-10, pushed the un-reset cumulative count past 10 and broke
    // this block's second test).
    async function flushSocialLoginThrottle(): Promise<void> {
      const redisConfig = app
        .get(ConfigService<AppConfig, true>)
        .get('redis', { infer: true });
      const redis = new Redis({
        host: redisConfig.host,
        port: redisConfig.port,
        password: redisConfig.password,
      });
      await redis.flushdb();
      await redis.quit();
    }

    beforeEach(async () => {
      await flushSocialLoginThrottle();
    });

    afterEach(async () => {
      await prisma.platformSetting.updateMany({
        where: {
          key: {
            in: [
              'customer.social-login.google.enabled',
              'customer.social-login.apple.enabled',
            ],
          },
        },
        data: { value: 'true' },
      });
    });

    it('rejects with SOCIAL_LOGIN_DISABLED when the customer.social-login.google.enabled setting is disabled, even for an otherwise-eligible account', async () => {
      await prisma.platformSetting.upsert({
        where: { key: 'customer.social-login.google.enabled' },
        update: { value: 'false' },
        create: {
          key: 'customer.social-login.google.enabled',
          description: 'Gates Google sign-in.',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          isPublic: true,
          value: 'false',
        },
      });

      const { subject, email } = await seedSocialUser(
        UserAccountStatus.EMAIL_VERIFIED,
      );
      const token = await jwksServer.signToken({
        issuer: ISSUER,
        audience: AUDIENCE,
        subject,
        email,
      });

      const response = await socialLoginRequest(token);
      const body = response.body as SocialLoginResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('SOCIAL_LOGIN_DISABLED');
      expect(body.errors?.[0].message).toBe(
        'Google sign-in is currently disabled.',
      );
    });

    it('succeeds again once the setting is re-enabled', async () => {
      await prisma.platformSetting.upsert({
        where: { key: 'customer.social-login.google.enabled' },
        update: { value: 'true' },
        create: {
          key: 'customer.social-login.google.enabled',
          description: 'Gates Google sign-in.',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          isPublic: true,
          value: 'true',
        },
      });

      const { subject, email, userId } = await seedSocialUser(
        UserAccountStatus.EMAIL_VERIFIED,
      );
      const token = await jwksServer.signToken({
        issuer: ISSUER,
        audience: AUDIENCE,
        subject,
        email,
      });

      const response = await socialLoginRequest(token);
      const body = response.body as SocialLoginResponseBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.socialLogin.userId).toBe(userId);
    });
  });

  /**
   * GOS-30/31/32 Slice 2 reference case, proven at the API layer: a MISSING
   * `customer.social-login.google.client-id` `PlatformSetting`
   * (`isEncrypted: true` — nobody has configured it in the admin panel yet)
   * rejects `socialLogin(GOOGLE, ...)` with the distinct
   * `SOCIAL_LOGIN_MISCONFIGURED` code — checked BEFORE JWT verification, so
   * this fires even for an otherwise-eligible, real account/token, and is
   * NOT collapsed into the generic `AUTHENTICATION_FAILED` result. Restores
   * the credential afterward so this suite never leaks a "misconfigured"
   * state to the rest of this describe block (which all depend on the
   * credential existing, seeded in this file's outer `beforeAll`).
   */
  describe('PlatformSettingPort.getValue gate (customer.social-login.google.client-id)', () => {
    // `socialLogin` is throttled (10 requests/60s — see
    // `AuthResolver.socialLogin`'s `@Throttle`), and every `it` ABOVE this
    // block in this same file already calls it enough times to sit right at
    // that limit. Flush the shared Redis-backed throttle counter before
    // EACH test in this block (not just once in `beforeAll` — this block now
    // has 3 of its own calls, one more than the 2 the original `beforeAll`
    // flush was sized for, found live when adding the "stored NON-encrypted"
    // test below) so no test in this block ever gets spuriously rejected
    // with `ThrottlerException` — same pattern as
    // `test/admin-platform-settings.e2e-spec.ts`'s own per-test flush, just
    // mid-file instead of covering the whole suite.
    async function flushSocialLoginThrottle(): Promise<void> {
      const redisConfig = app
        .get(ConfigService<AppConfig, true>)
        .get('redis', { infer: true });
      const redis = new Redis({
        host: redisConfig.host,
        port: redisConfig.port,
        password: redisConfig.password,
      });
      await redis.flushdb();
      await redis.quit();
    }

    beforeEach(async () => {
      await flushSocialLoginThrottle();
    });

    afterEach(async () => {
      const credentialEncryptionPort = app.get(CredentialEncryptionPort);
      await upsertClientIdCredential(
        credentialEncryptionPort,
        GOOGLE_CLIENT_ID_KEY,
        'GOOGLE',
        AUDIENCE,
      );
    });

    it('rejects with SOCIAL_LOGIN_MISCONFIGURED when no client-id PlatformSetting exists yet, even for an otherwise-eligible account', async () => {
      await prisma.platformSetting.delete({
        where: { key: GOOGLE_CLIENT_ID_KEY },
      });

      const { subject, email } = await seedSocialUser(
        UserAccountStatus.EMAIL_VERIFIED,
      );
      const token = await jwksServer.signToken({
        issuer: ISSUER,
        audience: AUDIENCE,
        subject,
        email,
      });

      const response = await socialLoginRequest(token);
      const body = response.body as SocialLoginResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe(
        'SOCIAL_LOGIN_MISCONFIGURED',
      );
      expect(body.errors?.[0].message).toBe(
        'Google sign-in is not fully configured yet.',
      );
    });

    it('succeeds again once the credential is configured', async () => {
      const credentialEncryptionPort = app.get(CredentialEncryptionPort);
      await upsertClientIdCredential(
        credentialEncryptionPort,
        GOOGLE_CLIENT_ID_KEY,
        'GOOGLE',
        AUDIENCE,
      );

      const { subject, email, userId } = await seedSocialUser(
        UserAccountStatus.EMAIL_VERIFIED,
      );
      const token = await jwksServer.signToken({
        issuer: ISSUER,
        audience: AUDIENCE,
        subject,
        email,
      });

      const response = await socialLoginRequest(token);
      const body = response.body as SocialLoginResponseBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.socialLogin.userId).toBe(userId);
    });

    /**
     * GOS-30/31/32 follow-up (2026-08-09): an OAuth client-id is a PUBLIC
     * identifier, not a secret — this proves `PlatformSettingPort.getValue`
     * (and, transitively, `JoseSocialIdentityValidationAdapter`) works
     * correctly when the underlying `PlatformSetting` row for
     * `customer.social-login.google.client-id` is stored NON-encrypted
     * (`isEncrypted: false`, plain `value` column), not just the encrypted
     * shape every other test in this describe block uses — proving the port
     * is genuinely encryption-shape-agnostic at the API layer, not just by
     * inspection of the adapter's own unit tests.
     */
    it('succeeds when the client-id PlatformSetting is stored NON-encrypted (a plain, public setting), not just the encrypted shape', async () => {
      await prisma.platformSetting.update({
        where: { key: GOOGLE_CLIENT_ID_KEY },
        data: {
          isEncrypted: false,
          value: AUDIENCE,
          ciphertext: null,
          iv: null,
          authTag: null,
          maskedPreview: null,
        },
      });

      const { subject, email, userId } = await seedSocialUser(
        UserAccountStatus.EMAIL_VERIFIED,
      );
      const token = await jwksServer.signToken({
        issuer: ISSUER,
        audience: AUDIENCE,
        subject,
        email,
      });

      const response = await socialLoginRequest(token);
      const body = response.body as SocialLoginResponseBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.socialLogin.userId).toBe(userId);
    });
  });
});
