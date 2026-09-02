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
  cleanProfilesData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const MY_CUSTOMER_PROFILE_QUERY = `
  query MyCustomerProfile {
    myCustomerProfile { id firstName lastName addressLine city province country photoUrl locationSharingEnabled }
  }
`;

const UPSERT_CUSTOMER_PROFILE_MUTATION = `
  mutation UpsertCustomerProfile($input: UpsertCustomerProfileInput!) {
    upsertCustomerProfile(input: $input) {
      id firstName lastName addressLine city province country photoUrl locationSharingEnabled
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface LoginResponseBody {
  data: { login: { userId: string; sessionToken: string } } | null;
}

interface MyCustomerProfileResponseBody {
  data: {
    myCustomerProfile: {
      id: string;
      firstName: string;
      lastName: string;
      addressLine: string;
      city: string;
      province: string;
      country: string;
      photoUrl: string | null;
      locationSharingEnabled: boolean;
    } | null;
  } | null;
  errors?: GraphQLErrorEntry[];
}

interface UpsertCustomerProfileResponseBody {
  data: {
    upsertCustomerProfile: {
      id: string;
      firstName: string;
      lastName: string;
      addressLine: string;
      city: string;
      province: string;
      country: string;
      photoUrl: string | null;
      locationSharingEnabled: boolean;
    };
  } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `profiles-cp-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * e2e coverage for `myCustomerProfile`/`upsertCustomerProfile` (GOS-14/
 * GOS-28) — the SessionGuard requirement, idempotent upsert (never a
 * duplicate row), DTO-layer validation, and — the story's central new
 * behavior — the one-time, never-reverted EMAIL_VERIFIED -> PENDING_APPROVAL
 * accountStatus transition on the very first successful creation.
 */
describe('GraphQL myCustomerProfile / upsertCustomerProfile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanProfilesData(prisma);
    await cleanUsersData(prisma);
    // Same rationale as other e2e specs: flush the shared Redis-backed
    // throttle counters this suite's `login` calls consume, so a later
    // spec file doesn't inherit a "throttled" state within the same 60s
    // window.
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

  async function seedEmailVerifiedUser(): Promise<{
    email: string;
    userId: string;
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
    return { email, userId: user.id };
  }

  async function loginSessionToken(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    const body = response.body as LoginResponseBody;
    return body.data!.login.sessionToken;
  }

  function myCustomerProfileRequest(sessionToken?: string) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query: MY_CUSTOMER_PROFILE_QUERY });
    if (sessionToken) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req.expect(200);
  }

  function upsertCustomerProfileRequest(
    input: Record<string, unknown>,
    sessionToken?: string,
  ) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query: UPSERT_CUSTOMER_PROFILE_MUTATION, variables: { input } });
    if (sessionToken) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req;
  }

  const VALID_INPUT = {
    firstName: 'Jane',
    lastName: 'Doe',
    addressLine: 'Av. Siempreviva 742',
    city: 'CABA',
    province: 'Buenos Aires',
  };

  it('returns null before any CustomerProfile has been created', async () => {
    const { email } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);

    const response = await myCustomerProfileRequest(sessionToken);
    const body = response.body as MyCustomerProfileResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.myCustomerProfile).toBeNull();
  });

  it(
    'first upsertCustomerProfile creates the profile (defaulting country ' +
      'to "AR") and transitions accountStatus EMAIL_VERIFIED -> PENDING_APPROVAL',
    async () => {
      const { email, userId } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);

      const response = await upsertCustomerProfileRequest(
        VALID_INPUT,
        sessionToken,
      ).expect(200);
      const body = response.body as UpsertCustomerProfileResponseBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.upsertCustomerProfile).toMatchObject({
        ...VALID_INPUT,
        country: 'AR',
      });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.accountStatus).toBe(UserAccountStatus.PENDING_APPROVAL);
    },
  );

  it(
    'a second call (edit) updates the same row — no duplicate row, no ' +
      're-transition/reversion of accountStatus',
    async () => {
      const { email, userId } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);

      await upsertCustomerProfileRequest(VALID_INPUT, sessionToken).expect(200);
      const firstUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(firstUser?.accountStatus).toBe(UserAccountStatus.PENDING_APPROVAL);

      const editResponse = await upsertCustomerProfileRequest(
        { ...VALID_INPUT, city: 'Rosario', province: 'Santa Fe' },
        sessionToken,
      ).expect(200);
      const editBody = editResponse.body as UpsertCustomerProfileResponseBody;

      expect(editBody.data?.upsertCustomerProfile).toMatchObject({
        city: 'Rosario',
        province: 'Santa Fe',
      });

      const rows = await prisma.customerProfile.findMany({
        where: { userId },
      });
      expect(rows).toHaveLength(1);

      const secondUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(secondUser?.accountStatus).toBe(
        UserAccountStatus.PENDING_APPROVAL,
      );
    },
  );

  it('myCustomerProfile without an Authorization header -> UNAUTHENTICATED', async () => {
    const response = await myCustomerProfileRequest();
    const body = response.body as MyCustomerProfileResponseBody;

    // myCustomerProfile is a nullable field, so a field-level error nulls
    // just that field (not the whole `data` object) — standard GraphQL
    // null-propagation, unlike the non-null mutations tested below.
    expect(body.data?.myCustomerProfile).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('upsertCustomerProfile without an Authorization header -> UNAUTHENTICATED', async () => {
    const response =
      await upsertCustomerProfileRequest(VALID_INPUT).expect(200);
    const body = response.body as UpsertCustomerProfileResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a missing required field (city) at the DTO validation layer', async () => {
    const { email } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);
    const { city, ...missingCity } = VALID_INPUT;
    void city;

    const response = await upsertCustomerProfileRequest(
      missingCity,
      sessionToken,
    );

    expect(response.body).toHaveProperty('errors');
  });

  it('accepts an optional photoUrl and returns it unchanged', async () => {
    const { email } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);

    const response = await upsertCustomerProfileRequest(
      { ...VALID_INPUT, photoUrl: 'https://cdn.example.com/photo.jpg' },
      sessionToken,
    ).expect(200);
    const body = response.body as UpsertCustomerProfileResponseBody;

    expect(body.data?.upsertCustomerProfile.photoUrl).toBe(
      'https://cdn.example.com/photo.jpg',
    );
  });

  it('rejects a malformed photoUrl at the DTO validation layer', async () => {
    const { email } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);

    const response = await upsertCustomerProfileRequest(
      { ...VALID_INPUT, photoUrl: 'not-a-url' },
      sessionToken,
    );

    expect(response.body).toHaveProperty('errors');
  });

  it('leaves photoUrl unchanged on an edit that omits it (not a wipe value)', async () => {
    const { email } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);

    await upsertCustomerProfileRequest(
      { ...VALID_INPUT, photoUrl: 'https://cdn.example.com/photo.jpg' },
      sessionToken,
    ).expect(200);

    const editResponse = await upsertCustomerProfileRequest(
      { ...VALID_INPUT, city: 'Cordoba' },
      sessionToken,
    ).expect(200);
    const editBody = editResponse.body as UpsertCustomerProfileResponseBody;

    expect(editBody.data?.upsertCustomerProfile.photoUrl).toBe(
      'https://cdn.example.com/photo.jpg',
    );
  });

  // GOS-62 — location-sharing consent flag: opt-in, default OFF, boolean
  // ONLY (no coordinates, no geolocation logic — see DEC-005, still status
  // "Proposed"). One seeded user/session threaded through all three
  // assertions (default -> explicit true -> edit that omits it) — same
  // "share a session across sequential assertions on the SAME row" instinct
  // as `upsertProfessionalProfileRequest`'s combined languages/photoUrl
  // test — deliberately kept to a single `login` call so this file's
  // shared 10-calls/60s `login` throttle budget isn't exceeded.
  it(
    'defaults locationSharingEnabled to false when omitted on creation, ' +
      'accepts and returns an explicit true, then leaves it unchanged ' +
      '(partial-update semantics — NOT reset to false) on a later edit ' +
      'that omits it, all reflected in myCustomerProfile too',
    async () => {
      const { email } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);

      const createResponse = await upsertCustomerProfileRequest(
        VALID_INPUT,
        sessionToken,
      ).expect(200);
      const createBody =
        createResponse.body as UpsertCustomerProfileResponseBody;
      expect(
        createBody.data?.upsertCustomerProfile.locationSharingEnabled,
      ).toBe(false);

      const trueResponse = await upsertCustomerProfileRequest(
        { ...VALID_INPUT, locationSharingEnabled: true },
        sessionToken,
      ).expect(200);
      const trueBody = trueResponse.body as UpsertCustomerProfileResponseBody;
      expect(trueBody.data?.upsertCustomerProfile.locationSharingEnabled).toBe(
        true,
      );

      const editResponse = await upsertCustomerProfileRequest(
        { ...VALID_INPUT, city: 'Cordoba' },
        sessionToken,
      ).expect(200);
      const editBody = editResponse.body as UpsertCustomerProfileResponseBody;
      expect(editBody.data?.upsertCustomerProfile.locationSharingEnabled).toBe(
        true,
      );

      const queryResponse = await myCustomerProfileRequest(sessionToken);
      const queryBody = queryResponse.body as MyCustomerProfileResponseBody;
      expect(queryBody.data?.myCustomerProfile?.locationSharingEnabled).toBe(
        true,
      );
    },
  );

  it('rejects a non-boolean locationSharingEnabled at the DTO validation layer', async () => {
    const { email } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);

    const response = await upsertCustomerProfileRequest(
      { ...VALID_INPUT, locationSharingEnabled: 'yes' },
      sessionToken,
    );

    expect(response.body).toHaveProperty('errors');
  });
});
