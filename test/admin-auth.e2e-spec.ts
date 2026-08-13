import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminUserStatus, Permission } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanAdminUsersData, createTestApp } from './support/test-app';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) {
      adminUserId
      sessionToken
      sessionExpiresAt
      email
      displayName
    }
  }
`;

const ADMIN_LOGOUT_MUTATION = `
  mutation AdminLogout {
    adminLogout
  }
`;

const ADMIN_ME_QUERY = `
  query AdminMe {
    adminMe
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface AdminLoginResponseBody {
  data: {
    adminLogin: {
      adminUserId: string;
      sessionToken: string;
      sessionExpiresAt: string;
      email: string;
      displayName: string;
    };
  } | null;
  errors?: GraphQLErrorEntry[];
}

interface AdminMeResponseBody {
  data: { adminMe: string } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-admin-1';

function uniqueEmail(): string {
  return `admin-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * e2e coverage for the `/admin/graphql` endpoint's `adminLogin`/
 * `adminLogout`/`adminMe` (the deviation-from-the-ticket additions — see the
 * platform-admin plan's "Deviations" section) and `AdminSessionGuard` end
 * to end, mirroring `test/auth-login.e2e-spec.ts`/
 * `test/auth-protected-resolver.e2e-spec.ts`'s shape.
 */
describe('GraphQL /admin/graphql — adminLogin/adminLogout/adminMe (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanAdminUsersData(prisma);
    // This suite calls the throttled `adminLogin` mutation several times
    // across its cases (limit 5/60s — see `AdminAuthResolver`'s
    // `@Throttle`). Flush the shared Redis-backed throttle counters so this
    // suite doesn't leak a "throttled" state into
    // `admin-feature-flags.e2e-spec.ts`, which also calls `adminLogin` and
    // may run in the same 60s window. Same pattern as
    // `auth-login.e2e-spec.ts`.
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

  async function seedActiveAdminUser(): Promise<{
    adminUserId: string;
    email: string;
  }> {
    const role = await prisma.adminRole.upsert({
      where: { name: 'SUPER_ADMIN' },
      update: {},
      create: {
        name: 'SUPER_ADMIN',
        permissions: [
          Permission.FEATURE_FLAGS_READ,
          Permission.FEATURE_FLAGS_WRITE,
        ],
      },
    });
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
    });
    const adminUser = await prisma.adminUser.create({
      data: {
        email,
        displayName: 'E2E Admin',
        passwordHash,
        roleId: role.id,
        status: AdminUserStatus.ACTIVE,
      },
    });
    return { adminUserId: adminUser.id, email };
  }

  function adminGraphqlRequest(query: string, variables?: unknown) {
    return request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query, variables });
  }

  it('adminLogin succeeds for a valid, ACTIVE admin and issues a real AdminSession row', async () => {
    const { adminUserId, email } = await seedActiveAdminUser();

    const response = await adminGraphqlRequest(ADMIN_LOGIN_MUTATION, {
      input: { email, password: PASSWORD },
    }).expect(200);
    const body = response.body as AdminLoginResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.adminLogin.adminUserId).toBe(adminUserId);
    expect(body.data?.adminLogin.email).toBe(email);
    expect(body.data?.adminLogin.displayName).toBe('E2E Admin');
    expect(body.data?.adminLogin.sessionToken).toEqual(
      expect.any(String) as unknown,
    );
    // GraphQLISODateTime, not the consumer's calendar-only Date scalar —
    // real time-of-day precision, not truncated to a calendar date.
    expect(body.data?.adminLogin.sessionExpiresAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );

    const sessions = await prisma.adminSession.findMany({
      where: { adminUserId },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toBe(body.data!.adminLogin.sessionToken);
  });

  it('adminLogin collapses a wrong password to the generic ADMIN_AUTHENTICATION_FAILED', async () => {
    const { email } = await seedActiveAdminUser();

    const response = await adminGraphqlRequest(ADMIN_LOGIN_MUTATION, {
      input: { email, password: 'wrong-password' },
    }).expect(200);
    const body = response.body as AdminLoginResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe(
      'ADMIN_AUTHENTICATION_FAILED',
    );
    expect(body.errors?.[0].message).toBe('Admin authentication failed.');
  });

  it('adminLogin collapses an unknown email to the SAME generic ADMIN_AUTHENTICATION_FAILED (anti-enumeration)', async () => {
    const response = await adminGraphqlRequest(ADMIN_LOGIN_MUTATION, {
      input: { email: uniqueEmail(), password: PASSWORD },
    }).expect(200);
    const body = response.body as AdminLoginResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe(
      'ADMIN_AUTHENTICATION_FAILED',
    );
  });

  it('adminMe rejects with ADMIN_UNAUTHENTICATED when no Authorization header is sent', async () => {
    const response = await adminGraphqlRequest(ADMIN_ME_QUERY).expect(200);
    const body = response.body as AdminMeResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
    expect(body.errors?.[0].message).toBe('Admin authentication required.');
  });

  it('adminMe rejects with ADMIN_UNAUTHENTICATED for a garbage/unknown token', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: ADMIN_ME_QUERY })
      .set('Authorization', 'Bearer not-a-real-admin-token')
      .expect(200);
    const body = response.body as AdminMeResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
  });

  it('adminMe returns the authenticated adminUserId for a valid, active admin session token', async () => {
    const { adminUserId, email } = await seedActiveAdminUser();
    const loginResponse = await adminGraphqlRequest(ADMIN_LOGIN_MUTATION, {
      input: { email, password: PASSWORD },
    }).expect(200);
    const sessionToken = (loginResponse.body as AdminLoginResponseBody).data!
      .adminLogin.sessionToken;

    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: ADMIN_ME_QUERY })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    const body = response.body as AdminMeResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.adminMe).toBe(adminUserId);
  });

  it('adminLogout revokes the session, after which adminMe rejects with ADMIN_UNAUTHENTICATED', async () => {
    const { email } = await seedActiveAdminUser();
    const loginResponse = await adminGraphqlRequest(ADMIN_LOGIN_MUTATION, {
      input: { email, password: PASSWORD },
    }).expect(200);
    const sessionToken = (loginResponse.body as AdminLoginResponseBody).data!
      .adminLogin.sessionToken;

    await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: ADMIN_LOGOUT_MUTATION })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: ADMIN_ME_QUERY })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    const body = response.body as AdminMeResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
  });

  it('adminLogout is idempotent and never throws for a missing token', async () => {
    const response = await adminGraphqlRequest(ADMIN_LOGOUT_MUTATION).expect(
      200,
    );
    const body = response.body as { data: { adminLogout: boolean } };

    expect(body.data.adminLogout).toBe(false);
  });
});
