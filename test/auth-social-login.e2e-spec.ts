import { INestApplication } from '@nestjs/common';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { SocialProvider } from '../src/auth/enums/social-provider.enum';
import type { SocialAuthProviderConfigMap } from '../src/auth/config/social-auth-provider.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';
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

/**
 * These tests validate `socialLogin` end-to-end against a locally-served
 * JWKS with a synthetic RS256-signed JWT (via `jose`'s own key-generation
 * helpers) — a substitute for real Google/Apple tokens, which cannot be
 * obtained in this environment. `SOCIAL_AUTH_PROVIDER_CONFIG` is overridden
 * to point at this local server instead of the real provider endpoints.
 *
 * Rewritten for GOS-7: `socialLogin` no longer auto-provisions a new
 * account on an unrecognized identity — it logs in an EXISTING, eligible
 * account only. Every failure surfaces the same `AUTHENTICATION_FAILED`
 * result `login` uses (not the old `SOCIAL_LOGIN_FAILED` code).
 */
describe('GraphQL socialLogin (e2e, synthetic JWKS substitute for real Google/Apple)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwksServer: LocalJwksServer;

  beforeAll(async () => {
    jwksServer = new LocalJwksServer();
    const { jwksUri } = await jwksServer.start();

    const socialAuthProviderConfig: SocialAuthProviderConfigMap = {
      [SocialProvider.GOOGLE]: { jwksUri, issuer: ISSUER, audience: AUDIENCE },
      [SocialProvider.APPLE]: { jwksUri, issuer: ISSUER, audience: AUDIENCE },
    };

    const ctx = await createTestApp({ socialAuthProviderConfig });
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
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

  it('rejects an unknown/unrecognized social subject with AUTHENTICATION_FAILED, never creating an account', async () => {
    const subject = `google-subject-unknown-${Date.now()}`;
    const token = await jwksServer.signToken({
      issuer: ISSUER,
      audience: AUDIENCE,
      subject,
      email: `unknown-${Date.now()}@example.com`,
    });

    const usersBefore = await prisma.user.count();

    const response = await socialLoginRequest(token);
    const body = response.body as SocialLoginResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_FAILED');
    expect(body.errors?.[0].message).toBe('Authentication failed.');

    const usersAfter = await prisma.user.count();
    expect(usersAfter).toBe(usersBefore); // no auto-provisioned account
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
});
