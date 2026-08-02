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
    login(input: $input) { userId sessionToken }
  }
`;

const LOGOUT_MUTATION = `
  mutation Logout {
    logout
  }
`;

const ME_QUERY = `
  query Me {
    me
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface LoginResponseBody {
  data: { login: { userId: string; sessionToken: string } } | null;
}

interface MeResponseBody {
  data: { me: string } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `me-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * e2e coverage for the reusable `SessionGuard` + `@CurrentUser()` infra
 * (`src/auth/guards/session.guard.ts`, `src/auth/decorators/current-user.decorator.ts`)
 * via `AuthResolver`'s `me` reference query — the copy-paste example any
 * future protected mutation/query is meant to follow. This is NOT testing
 * `me` as a product feature; it exists to prove the guard itself actually
 * blocks/allows requests end-to-end, including a real revoked-session case
 * that a unit test alone can't fully prove (it depends on the real
 * `PostgresSessionAdapter`/Postgres round trip).
 */
describe('GraphQL protected resolver (SessionGuard) (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    // Same rationale as `auth-login.e2e-spec.ts`/`auth-logout.e2e-spec.ts`:
    // flush the shared Redis-backed throttle counters this suite's `login`
    // calls consume, so a later spec file doesn't inherit a "throttled"
    // state within the same 60s window.
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
   * Seeds a password account directly via Prisma (real argon2id hash,
   * deliberately not via `register`, to avoid consuming its own separate
   * throttle budget), then drives the real `login` mutation to obtain a
   * genuine `PostgresSessionAdapter`-issued session token.
   */
  async function realLoginSessionToken(): Promise<{
    userId: string;
    sessionToken: string;
  }> {
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
    });
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

    const loginResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    const loginBody = loginResponse.body as LoginResponseBody;

    return {
      userId: user.id,
      sessionToken: loginBody.data!.login.sessionToken,
    };
  }

  function meRequest(authorizationHeader?: string) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query: ME_QUERY });
    if (authorizationHeader !== undefined) {
      req.set('Authorization', authorizationHeader);
    }
    return req.expect(200);
  }

  it('returns the authenticated userId for a valid, active session token', async () => {
    const { userId, sessionToken } = await realLoginSessionToken();

    const response = await meRequest(`Bearer ${sessionToken}`);
    const body = response.body as MeResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.me).toBe(userId);
  });

  it('rejects with UNAUTHENTICATED when no Authorization header is sent', async () => {
    const response = await meRequest();
    const body = response.body as MeResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
    expect(body.errors?.[0].message).toBe('Authentication required.');
  });

  it('rejects with UNAUTHENTICATED for a garbage/unknown token', async () => {
    const response = await meRequest('Bearer not-a-real-token');
    const body = response.body as MeResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
    expect(body.errors?.[0].message).toBe('Authentication required.');
  });

  it('rejects with UNAUTHENTICATED for a session token that was revoked via logout', async () => {
    const { sessionToken } = await realLoginSessionToken();

    await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: LOGOUT_MUTATION })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);

    const response = await meRequest(`Bearer ${sessionToken}`);
    const body = response.body as MeResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
  });
});
