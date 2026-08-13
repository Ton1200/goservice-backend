import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
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

interface LoginResponseBody {
  data: {
    login: {
      userId: string;
      sessionToken: string;
      sessionExpiresAt: string;
      errors: { code: string; message: string }[];
    };
  } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `login-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe('GraphQL login (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    // This suite calls the throttled `login` mutation many times across
    // its cases — flush the shared Redis-backed throttle counters (same
    // keys other e2e spec files' `login`/`register` calls use) so this
    // suite doesn't leak a "throttled" state into whichever spec file
    // happens to run next in the same 60s window. Same pattern as
    // `users-rate-limiting.e2e-spec.ts`.
    const redisConfig = app.get(ConfigService<AppConfig, true>).get('redis', {
      infer: true,
    });
    const redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    });
    await redis.flushdb();
    await redis.quit();
    await app.close();
  });

  /**
   * Seeds a password account directly via Prisma with a REAL argon2id hash
   * of `PASSWORD` (the same hashing the real `Argon2PasswordHasherAdapter`
   * produces) — deliberately NOT via the `register` mutation, so this
   * suite doesn't consume `register`'s own separate, shared throttle
   * budget (10/60s) and starve `users-register.e2e-spec.ts` when both run
   * in the same test process/window.
   */
  async function seedUser(
    accountStatus: UserAccountStatus,
  ): Promise<{ email: string; userId: string }> {
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash,
        phoneCountryCode: '+54',
        phoneNumber: '91123456789',
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus,
      },
    });
    return { email, userId: user.id };
  }

  async function seedSocialOnlyUser(): Promise<{
    email: string;
    userId: string;
  }> {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        authProvider: AuthProvider.GOOGLE,
        socialProviderSubject: `google-subject-${Date.now()}`,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
        acceptedTermsAndPrivacy: true,
        passwordHash: null,
      },
    });
    return { email, userId: user.id };
  }

  async function loginRequest(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password } },
      })
      .expect(200);
  }

  it('logs in successfully for an EMAIL_VERIFIED account and creates a real Session row', async () => {
    const { email, userId } = await seedUser(UserAccountStatus.EMAIL_VERIFIED);

    const response = await loginRequest(email, PASSWORD);
    const body = response.body as LoginResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.login.userId).toBe(userId);
    expect(body.data?.login.sessionToken).toEqual(
      expect.any(String) as unknown,
    );
    expect(body.data?.login.sessionExpiresAt).toEqual(
      expect.any(String) as unknown,
    );

    const sessionToken = body.data!.login.sessionToken;
    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toBe(sessionToken);
    expect(sessions[0].status).toBe('ACTIVE');
  });

  it('logs in successfully for an APPROVED account and creates a real Session row', async () => {
    const { email, userId } = await seedUser(UserAccountStatus.APPROVED);

    const response = await loginRequest(email, PASSWORD);
    const body = response.body as LoginResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.login.userId).toBe(userId);

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);
  });

  it('logs in successfully end-to-end for a PENDING_APPROVAL account (identity approval pending, but login-eligible) and creates a real Session row', async () => {
    const { email, userId } = await seedUser(
      UserAccountStatus.PENDING_APPROVAL,
    );

    const response = await loginRequest(email, PASSWORD);
    const body = response.body as LoginResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.login.userId).toBe(userId);

    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('ACTIVE');
  });

  it('rejects a wrong password with AUTHENTICATION_FAILED, creating no session', async () => {
    const { email, userId } = await seedUser(UserAccountStatus.EMAIL_VERIFIED);

    const response = await loginRequest(email, 'not-the-real-password');
    const body = response.body as LoginResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_FAILED');
    expect(body.errors?.[0].message).toBe('Authentication failed.');
    await expect(
      prisma.session.findMany({ where: { userId } }),
    ).resolves.toHaveLength(0);
  });

  it('rejects a nonexistent email with the same AUTHENTICATION_FAILED result, creating no session', async () => {
    const response = await loginRequest('nobody-at-all@example.com', PASSWORD);
    const body = response.body as LoginResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_FAILED');
    expect(body.errors?.[0].message).toBe('Authentication failed.');
  });

  it('rejects a password login attempt against a social-only account, creating no session', async () => {
    const { email, userId } = await seedSocialOnlyUser();

    const response = await loginRequest(email, PASSWORD);
    const body = response.body as LoginResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_FAILED');
    await expect(
      prisma.session.findMany({ where: { userId } }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.REJECTED,
  ])(
    'rejects an ineligible-status (%s) account with the same AUTHENTICATION_FAILED result, creating no session',
    async (accountStatus) => {
      const { email, userId } = await seedUser(accountStatus);

      const response = await loginRequest(email, PASSWORD);
      const body = response.body as LoginResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_FAILED');
      expect(body.errors?.[0].message).toBe('Authentication failed.');
      await expect(
        prisma.session.findMany({ where: { userId } }),
      ).resolves.toHaveLength(0);
    },
  );
});
