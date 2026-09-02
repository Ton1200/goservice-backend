import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanIdentityVerificationData,
  cleanPlatformSettingsData,
  cleanProfilesData,
  cleanUsersData,
  createTestApp,
  enableTestIdentityVerification,
  IDENTITY_VERIFICATION_TEST_SETTING_KEYS,
  TEST_DIDIT_WEBHOOK_SECRET,
} from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const UPSERT_CUSTOMER_PROFILE_MUTATION = `
  mutation UpsertCustomerProfile($input: UpsertCustomerProfileInput!) {
    upsertCustomerProfile(input: $input) { id country }
  }
`;

const START_IDENTITY_VERIFICATION_MUTATION = `
  mutation StartIdentityVerification {
    startIdentityVerification {
      id
      status
      documentCheckPassed
      biometricCheckPassed
      verificationUrl
    }
  }
`;

const MY_IDENTITY_VERIFICATION_STATUS_QUERY = `
  query MyIdentityVerificationStatus {
    myIdentityVerificationStatus {
      id
      status
      documentCheckPassed
      biometricCheckPassed
      verificationUrl
    }
  }
`;

const PLATFORM_CONFIG_QUERY = `
  query PlatformConfig {
    platformConfig
  }
`;

const PASSWORD = 'super-secret-1';

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

function uniqueEmail(): string {
  return `identity-verification-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

const CUSTOMER_INPUT = {
  firstName: 'Jane',
  lastName: 'Doe',
  addressLine: 'Av. Siempreviva 742',
  city: 'CABA',
  province: 'Buenos Aires',
  country: 'AR',
};

function signWebhookBody(rawBody: string, timestampSeconds: number) {
  const signature = createHmac('sha256', TEST_DIDIT_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex');
  return {
    'x-signature-v2': signature,
    'x-timestamp': String(timestampSeconds),
  };
}

/**
 * e2e coverage for `startIdentityVerification`/`myIdentityVerificationStatus`
 * (GraphQL, `/graphql`) and the Didit webhook (`POST
 * /webhooks/didit/identity-verification`, plain REST) — see the Identity
 * Verification implementation plan's section 12 for the full case list this
 * suite is built from. Didit's real API (`verification.didit.me`) is NEVER
 * called — `global.fetch` is monkey-patched per test that needs
 * `createSession` to succeed; every other case fails before `fetch` is ever
 * reached.
 */
describe('Identity Verification (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    const redisConfig = app.get(ConfigService<AppConfig, true>).get('redis', {
      infer: true,
    });
    redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    });
  });

  // This suite makes several GraphQL requests per test (login +
  // upsertCustomerProfile + startIdentityVerification, sometimes more) —
  // comfortably enough, across its own ~15 tests, to exceed the GLOBAL
  // `GqlThrottlerGuard` limit (20 requests/60s, shared across EVERY
  // GraphQL operation app-wide, not per-mutation — see `app.module.ts`'s
  // `ThrottlerModule.forRootAsync`) within a single 60s window, even
  // starting from a clean counter. Flushing the shared Redis-backed
  // throttler storage before EVERY test (not just once, in `beforeAll`)
  // keeps each test's own request budget full — mirrors
  // `users-rate-limiting.e2e-spec.ts`'s own end-of-suite flush, just run
  // more frequently here given this suite's higher per-test request count.
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    await cleanIdentityVerificationData(prisma);
    await cleanProfilesData(prisma);
    await cleanUsersData(prisma);
    await cleanPlatformSettingsData(
      prisma,
      IDENTITY_VERIFICATION_TEST_SETTING_KEYS,
    );
    await redis.flushdb();
    await redis.quit();
    await app.close();
  });

  async function seedPendingApprovalUserWithSessionToken(): Promise<{
    userId: string;
    sessionToken: string;
  }> {
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await prisma.user.create({
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
    const loginBody = loginResponse.body as {
      data: { login: { userId: string; sessionToken: string } };
    };
    const { userId, sessionToken } = loginBody.data.login;

    const profileResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: UPSERT_CUSTOMER_PROFILE_MUTATION,
        variables: { input: CUSTOMER_INPUT },
      })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    expect(
      (profileResponse.body as { errors?: unknown }).errors,
    ).toBeUndefined();

    return { userId, sessionToken };
  }

  function mockDiditCreateSessionOnce(): void {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          session_id: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          url: 'https://verify.didit.me/e2e-fake-session',
        }),
    });
  }

  function startIdentityVerificationRequest(sessionToken: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query: START_IDENTITY_VERIFICATION_MUTATION })
      .set('Authorization', `Bearer ${sessionToken}`);
  }

  describe('startIdentityVerification — guard/kill-switch/misconfiguration errors', () => {
    it('UNAUTHENTICATED without a session token', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: START_IDENTITY_VERIFICATION_MUTATION })
        .expect(200);
      const body = response.body as { errors?: GraphQLErrorEntry[] };
      expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    });

    it('ACCOUNT_NOT_PENDING_APPROVAL when the account has no profile yet (still EMAIL_VERIFIED)', async () => {
      const email = uniqueEmail();
      const passwordHash = await argon2.hash(PASSWORD, {
        type: argon2.argon2id,
      });
      await prisma.user.create({
        data: {
          email,
          firstName: 'No',
          lastName: 'Profile',
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
      const sessionToken = (
        loginResponse.body as { data: { login: { sessionToken: string } } }
      ).data.login.sessionToken;

      const response =
        await startIdentityVerificationRequest(sessionToken).expect(200);
      const body = response.body as { errors?: GraphQLErrorEntry[] };
      expect(body.errors?.[0]?.extensions?.code).toBe(
        'ACCOUNT_NOT_PENDING_APPROVAL',
      );
    });

    it('IDENTITY_VERIFICATION_DISABLED when identity.enabled is false, and platformConfig reflects it consistently', async () => {
      const { sessionToken } = await seedPendingApprovalUserWithSessionToken();
      await prisma.platformSetting.upsert({
        where: { key: 'identity.enabled' },
        update: { value: 'false' },
        create: {
          key: 'identity.enabled',
          description: 'Global kill switch.',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          isPublic: true,
          value: 'false',
        },
      });

      const response =
        await startIdentityVerificationRequest(sessionToken).expect(200);
      const body = response.body as { errors?: GraphQLErrorEntry[] };
      expect(body.errors?.[0]?.extensions?.code).toBe(
        'IDENTITY_VERIFICATION_DISABLED',
      );

      const configResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: PLATFORM_CONFIG_QUERY })
        .expect(200);
      const configBody = configResponse.body as {
        data: { platformConfig: { identity?: { enabled?: boolean } } };
      };
      expect(configBody.data.platformConfig.identity?.enabled).toBe(false);
    });

    // A former `IDENTITY_VERIFICATION_COUNTRY_NOT_SUPPORTED when the caller
    // profile country has no routing switch on` test lived here — REMOVED
    // (2026-08-15, human-requested simplification): there is no longer any
    // per-country `identity.routing.<country>.enabled` switch to turn off.
    // See `identity-verification-provider-registry.service.spec.ts` for
    // coverage that BOTH `CountryCode` values (`AR`/`CO`) resolve
    // identically once the two global switches are on, and the "resolves
    // successfully for CO too" test in the "happy path" describe block
    // below for the e2e-level confirmation that CO works out of the box
    // with no extra per-country configuration.

    it('IDENTITY_VERIFICATION_MISCONFIGURED when Didit is enabled but the active mode has no api-key/workflow-id configured', async () => {
      const { sessionToken } = await seedPendingApprovalUserWithSessionToken();
      // A PRIOR test in this suite may have already called
      // `enableTestIdentityVerification` (which also writes real
      // sandbox api-key/workflow-id rows) — delete them explicitly first,
      // so this test starts from a genuinely unconfigured state rather
      // than depending on test-execution order.
      await prisma.platformSetting.deleteMany({
        where: {
          key: {
            in: [
              'identity.didit.sandbox.api-key',
              'identity.didit.sandbox.workflow-id',
            ],
          },
        },
      });
      // Enable the kill switches WITHOUT the credential rows —
      // `enableTestIdentityVerification` always sets credentials too, so
      // this test upserts the flags directly instead.
      for (const key of ['identity.enabled', 'identity.didit.enabled']) {
        await prisma.platformSetting.upsert({
          where: { key },
          update: { value: 'true' },
          create: {
            key,
            description: 'e2e',
            valueType: 'BOOLEAN',
            isEncrypted: false,
            isPublic: false,
            value: 'true',
          },
        });
      }
      await prisma.platformSetting.upsert({
        where: { key: 'identity.didit.mode' },
        update: { value: 'SANDBOX' },
        create: {
          key: 'identity.didit.mode',
          description: 'e2e',
          valueType: 'STRING',
          isEncrypted: false,
          isPublic: false,
          value: 'SANDBOX',
        },
      });

      const response =
        await startIdentityVerificationRequest(sessionToken).expect(200);
      const body = response.body as { errors?: GraphQLErrorEntry[] };
      expect(body.errors?.[0]?.extensions?.code).toBe(
        'IDENTITY_VERIFICATION_MISCONFIGURED',
      );
    });
  });

  describe('startIdentityVerification — happy path', () => {
    it('creates an IdentityVerification in PENDING, returns a verificationUrl, and country is never a client-supplied argument', async () => {
      const { userId, sessionToken } =
        await seedPendingApprovalUserWithSessionToken();
      await enableTestIdentityVerification(app, prisma);
      mockDiditCreateSessionOnce();

      const response =
        await startIdentityVerificationRequest(sessionToken).expect(200);
      const body = response.body as {
        data?: { startIdentityVerification: Record<string, unknown> };
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
      expect(body.data?.startIdentityVerification).toMatchObject({
        status: 'PENDING',
        documentCheckPassed: null,
        biometricCheckPassed: null,
      });
      expect(
        (body.data?.startIdentityVerification as { verificationUrl: string })
          .verificationUrl,
      ).toContain('https://');

      const row = await prisma.identityVerification.findFirst({
        where: { userId },
      });
      expect(row?.status).toBe('PENDING');
      expect(row?.country).toBe('AR');
      expect(row?.provider).toBe('didit');
    });

    it('the schema does not accept any `country`/other argument on startIdentityVerification', async () => {
      const { sessionToken } = await seedPendingApprovalUserWithSessionToken();

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `mutation { startIdentityVerification(country: AR) { id } }`,
        })
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(400);
      const body = response.body as { errors?: GraphQLErrorEntry[] };
      expect(body.errors?.[0]?.message).toMatch(/Unknown argument "country"/);
    });

    it('resolves successfully for CO too, with the exact same two global switches — no per-country routing config needed (2026-08-15)', async () => {
      const email = uniqueEmail();
      const passwordHash = await argon2.hash(PASSWORD, {
        type: argon2.argon2id,
      });
      await prisma.user.create({
        data: {
          email,
          firstName: 'Juan',
          lastName: 'Perez',
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
      const loginBody = loginResponse.body as {
        data: { login: { userId: string; sessionToken: string } };
      };
      const { userId, sessionToken } = loginBody.data.login;

      const profileResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: UPSERT_CUSTOMER_PROFILE_MUTATION,
          variables: {
            input: {
              ...CUSTOMER_INPUT,
              city: 'Bogotá',
              province: 'Bogotá D.C.',
              country: 'CO',
            },
          },
        })
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect(
        (profileResponse.body as { errors?: unknown }).errors,
      ).toBeUndefined();

      await enableTestIdentityVerification(app, prisma);
      mockDiditCreateSessionOnce();

      const response =
        await startIdentityVerificationRequest(sessionToken).expect(200);
      const body = response.body as {
        data?: { startIdentityVerification: Record<string, unknown> };
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
      expect(body.data?.startIdentityVerification).toMatchObject({
        status: 'PENDING',
      });

      const row = await prisma.identityVerification.findFirst({
        where: { userId },
      });
      expect(row?.country).toBe('CO');
    });
  });

  describe('myIdentityVerificationStatus', () => {
    it('is null when the user has never started a verification attempt', async () => {
      const { sessionToken } = await seedPendingApprovalUserWithSessionToken();

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: MY_IDENTITY_VERIFICATION_STATUS_QUERY })
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      const body = response.body as {
        data: { myIdentityVerificationStatus: unknown };
      };
      expect(body.data.myIdentityVerificationStatus).toBeNull();
    });

    it('reflects the most recent attempt, with verificationUrl always null', async () => {
      const { sessionToken } = await seedPendingApprovalUserWithSessionToken();
      await enableTestIdentityVerification(app, prisma);
      mockDiditCreateSessionOnce();
      await startIdentityVerificationRequest(sessionToken).expect(200);

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: MY_IDENTITY_VERIFICATION_STATUS_QUERY })
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      const body = response.body as {
        data: { myIdentityVerificationStatus: Record<string, unknown> };
      };
      expect(body.data.myIdentityVerificationStatus).toMatchObject({
        status: 'PENDING',
        verificationUrl: null,
      });
    });
  });

  describe('POST /webhooks/didit/identity-verification', () => {
    async function startVerificationAndGetRow(): Promise<{
      userId: string;
      identityVerificationId: string;
    }> {
      const { userId, sessionToken } =
        await seedPendingApprovalUserWithSessionToken();
      await enableTestIdentityVerification(app, prisma);
      mockDiditCreateSessionOnce();
      const response =
        await startIdentityVerificationRequest(sessionToken).expect(200);
      const body = response.body as {
        data: { startIdentityVerification: { id: string } };
      };
      return {
        userId,
        identityVerificationId: body.data.startIdentityVerification.id,
      };
    }

    function approvedPayload(vendorData: string) {
      return JSON.stringify({
        event_id: 'evt-1',
        webhook_type: 'status.updated',
        timestamp: Math.floor(Date.now() / 1000),
        session_id: 'session-webhook-1',
        status: 'Approved',
        vendor_data: vendorData,
        decision: {
          id_verifications: [
            { status: 'Approved', document_type: 'Identity Card' },
          ],
          liveness_checks: [
            { status: 'Approved', method: 'ACTIVE_3D', score: 95 },
          ],
          face_matches: [{ status: 'Approved', score: 96 }],
        },
      });
    }

    function rejectedPayload(vendorData: string) {
      return JSON.stringify({
        event_id: 'evt-2',
        webhook_type: 'status.updated',
        timestamp: Math.floor(Date.now() / 1000),
        session_id: 'session-webhook-2',
        status: 'Declined',
        vendor_data: vendorData,
        decision: {
          id_verifications: [
            { status: 'Declined', document_type: 'Identity Card' },
          ],
          liveness_checks: [
            { status: 'Approved', method: 'ACTIVE_3D', score: 95 },
          ],
          face_matches: [{ status: 'Approved', score: 96 }],
        },
      });
    }

    it('happy path: valid signature + fully-approved decision -> IdentityVerification APPROVED and User.accountStatus APPROVED', async () => {
      const { userId, identityVerificationId } =
        await startVerificationAndGetRow();
      const rawBody = approvedPayload(identityVerificationId);
      const timestampSeconds = Math.floor(Date.now() / 1000);
      const headers = signWebhookBody(rawBody, timestampSeconds);

      await request(app.getHttpServer())
        .post('/webhooks/didit/identity-verification')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody)
        .expect(200);

      const row = await prisma.identityVerification.findUnique({
        where: { id: identityVerificationId },
      });
      expect(row?.status).toBe('APPROVED');
      expect(row?.documentCheckPassed).toBe(true);
      expect(row?.biometricCheckPassed).toBe(true);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.accountStatus).toBe('APPROVED');
    });

    it('a document/biometric rejection -> IdentityVerification REJECTED and User.accountStatus REJECTED', async () => {
      const { userId, identityVerificationId } =
        await startVerificationAndGetRow();
      const rawBody = rejectedPayload(identityVerificationId);
      const timestampSeconds = Math.floor(Date.now() / 1000);
      const headers = signWebhookBody(rawBody, timestampSeconds);

      await request(app.getHttpServer())
        .post('/webhooks/didit/identity-verification')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody)
        .expect(200);

      const row = await prisma.identityVerification.findUnique({
        where: { id: identityVerificationId },
      });
      expect(row?.status).toBe('REJECTED');

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.accountStatus).toBe('REJECTED');
    });

    it('an invalid signature is rejected with 401 and never touches the IdentityVerification row', async () => {
      const { identityVerificationId } = await startVerificationAndGetRow();
      const rawBody = approvedPayload(identityVerificationId);
      const timestampSeconds = Math.floor(Date.now() / 1000);

      await request(app.getHttpServer())
        .post('/webhooks/didit/identity-verification')
        .set('Content-Type', 'application/json')
        .set({
          'x-signature-v2': 'not-a-real-signature',
          'x-timestamp': String(timestampSeconds),
        })
        .send(rawBody)
        .expect(401);

      const row = await prisma.identityVerification.findUnique({
        where: { id: identityVerificationId },
      });
      expect(row?.status).toBe('PENDING');
      expect(row?.documentCheckPassed).toBeNull();
    });

    it('a duplicate delivery of the same webhook is a no-op the second time (no error, no re-processing)', async () => {
      const { userId, identityVerificationId } =
        await startVerificationAndGetRow();
      const rawBody = approvedPayload(identityVerificationId);
      const timestampSeconds = Math.floor(Date.now() / 1000);
      const headers = signWebhookBody(rawBody, timestampSeconds);

      await request(app.getHttpServer())
        .post('/webhooks/didit/identity-verification')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody)
        .expect(200);
      // Second, identical delivery — same signature, same body.
      await request(app.getHttpServer())
        .post('/webhooks/didit/identity-verification')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody)
        .expect(200);

      const row = await prisma.identityVerification.findUnique({
        where: { id: identityVerificationId },
      });
      expect(row?.status).toBe('APPROVED');
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.accountStatus).toBe('APPROVED');
    });

    it('never overwrites a decision an admin already made manually before the webhook arrived', async () => {
      const { userId, identityVerificationId } =
        await startVerificationAndGetRow();

      // Admin manually rejects the account FIRST (same mechanism as
      // `updateUserAccount` — direct write here, since exercising the full
      // admin GraphQL mutation is out of this suite's scope).
      await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: 'REJECTED' },
      });

      const rawBody = approvedPayload(identityVerificationId);
      const timestampSeconds = Math.floor(Date.now() / 1000);
      const headers = signWebhookBody(rawBody, timestampSeconds);

      await request(app.getHttpServer())
        .post('/webhooks/didit/identity-verification')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody)
        .expect(200);

      // The IdentityVerification row itself still updates (it's an
      // independent record of what Didit reported)...
      const row = await prisma.identityVerification.findUnique({
        where: { id: identityVerificationId },
      });
      expect(row?.status).toBe('APPROVED');
      // ...but the User's own accountStatus, already manually decided,
      // must NOT be overwritten back to APPROVED by the later webhook.
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.accountStatus).toBe('REJECTED');
    });
  });
});
