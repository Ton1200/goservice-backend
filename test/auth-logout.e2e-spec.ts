import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { hashSessionToken } from '../src/auth/services/session-token.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const LOGOUT_MUTATION = `
  mutation Logout {
    logout
  }
`;

interface LoginResponseBody {
  data: { login: { userId: string; sessionToken: string } } | null;
}

interface LogoutResponseBody {
  data: { logout: boolean } | null;
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `logout-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe('GraphQL logout (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    // This suite calls the throttled `login` mutation several times —
    // flush the shared Redis-backed throttle counters so this suite
    // doesn't leak a "throttled" state into whichever spec file happens to
    // run next in the same 60s window. Same pattern as
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
   * (deliberately NOT via the `register` mutation, to avoid consuming its
   * own separate, shared throttle budget), then drives the REAL `login`
   * mutation to obtain a genuine, `PostgresSessionAdapter`-issued session
   * token — the part this suite actually needs to exercise.
   */
  async function realLoginSessionToken(): Promise<{
    userId: string;
    sessionToken: string;
  }> {
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    const userId = user.id;

    const loginResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    const loginBody = loginResponse.body as LoginResponseBody;

    return { userId, sessionToken: loginBody.data!.login.sessionToken };
  }

  function logoutRequest(sessionToken?: string) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query: LOGOUT_MUTATION });
    if (sessionToken !== undefined) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req.expect(200);
  }

  it('revokes a real, active session (logout returns true) and flips the row to REVOKED', async () => {
    const { userId, sessionToken } = await realLoginSessionToken();

    const response = await logoutRequest(sessionToken);
    const body = response.body as LogoutResponseBody;

    expect(body.data?.logout).toBe(true);

    const session = await prisma.session.findFirst({ where: { userId } });
    expect(session?.status).toBe('REVOKED');
    expect(session?.revokedAt).not.toBeNull();
  });

  it('is idempotent: logging out the same token a second time returns false', async () => {
    const { sessionToken } = await realLoginSessionToken();

    await logoutRequest(sessionToken).then((response) => {
      const body = response.body as LogoutResponseBody;
      expect(body.data?.logout).toBe(true);
    });

    const secondResponse = await logoutRequest(sessionToken);
    const secondBody = secondResponse.body as LogoutResponseBody;
    expect(secondBody.data?.logout).toBe(false);
  });

  it('returns false for an unknown session token, never throwing', async () => {
    const unknownToken = randomBytes(32).toString('base64url');

    const response = await logoutRequest(unknownToken);
    const body = response.body as LogoutResponseBody;

    expect(response.body).not.toHaveProperty('errors');
    expect(body.data?.logout).toBe(false);
  });

  it('returns false, never throwing, when no Authorization header is sent at all', async () => {
    const response = await logoutRequest();
    const body = response.body as LogoutResponseBody;

    expect(response.body).not.toHaveProperty('errors');
    expect(body.data?.logout).toBe(false);
  });

  it('returns false and flips a pre-seeded, already-expired ACTIVE session to EXPIRED', async () => {
    const plaintextToken = randomBytes(32).toString('base64url');
    const { userId } = await realLoginSessionToken();
    const seeded = await prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(plaintextToken),
        expiresAt: new Date(Date.now() - 60_000), // already expired
      },
    });

    const response = await logoutRequest(plaintextToken);
    const body = response.body as LogoutResponseBody;

    expect(body.data?.logout).toBe(false);

    const updated = await prisma.session.findUnique({
      where: { id: seeded.id },
    });
    expect(updated?.status).toBe('EXPIRED');
  });
});
