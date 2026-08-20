import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthProvider,
  CountryCode,
  ProfessionalVerificationStatus,
  SpecializationRole,
  UserAccountStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { snapToGrid } from '../src/geo/utils/snap-to-grid.util';
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

const NEARBY_PROFESSIONALS_QUERY = `
  query NearbyProfessionals($input: NearbyProfessionalsInput!) {
    nearbyProfessionals(input: $input) {
      distanceKm
      profile {
        id
        displayName
        approximateLatitude
        approximateLongitude
        serviceAreaRadiusKm
      }
    }
  }
`;

const NEARBY_PROFESSIONALS_QUERY_WITH_FORBIDDEN_FIELDS = `
  query NearbyProfessionalsForbidden($input: NearbyProfessionalsInput!) {
    nearbyProfessionals(input: $input) {
      distanceKm
      profile {
        id
        serviceAreaLatitude
        serviceAreaLongitude
      }
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

interface NearbyProfessionalPayload {
  distanceKm: number;
  profile: {
    id: string;
    displayName: string;
    approximateLatitude: number | null;
    approximateLongitude: number | null;
    serviceAreaRadiusKm: number | null;
  };
}

interface NearbyProfessionalsResponseBody {
  data: { nearbyProfessionals: NearbyProfessionalPayload[] } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';

const OBELISCO = { latitude: -34.6037, longitude: -58.3816 };

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const NEARBY_EXACT_CENTER = {
  latitude: OBELISCO.latitude,
  longitude: OBELISCO.longitude + 0.005,
};
const NOT_WILLING_EXACT_CENTER = {
  latitude: OBELISCO.latitude,
  longitude: OBELISCO.longitude + 0.02,
};
const FAR_EXACT_CENTER = { latitude: -31.4201, longitude: -64.1888 };

/** e2e coverage for `Query.nearbyProfessionals` (Proximity Discovery, ADR 0006 / DEC-005). */
describe('GraphQL nearbyProfessionals (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanProfilesData(prisma);
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
    await cleanUsersData(prisma);
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

  async function seedUser(
    accountStatus: UserAccountStatus,
    emailPrefix: string,
  ): Promise<{ email: string; userId: string }> {
    const email = uniqueEmail(emailPrefix);
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Test',
        lastName: 'User',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus,
      },
    });
    return { email, userId: user.id };
  }

  async function seedApprovedCustomer(): Promise<{
    email: string;
    userId: string;
  }> {
    const { email, userId } = await seedUser(
      UserAccountStatus.APPROVED,
      'discovery-customer',
    );
    await prisma.customerProfile.create({
      data: {
        userId,
        displayName: 'Cliente de Prueba',
        addressLine: 'Calle Falsa 123',
        city: 'CABA',
        province: 'Buenos Aires',
        country: CountryCode.AR,
      },
    });
    return { email, userId };
  }

  /** Seeds an APPROVED `ProfessionalProfile` with a Service Area already configured, using the real `snapToGrid` utility. */
  async function seedApprovedProfessionalWithServiceArea(params: {
    exactCenter: { latitude: number; longitude: number };
    serviceAreaRadiusKm: number;
    categoryIds: string[];
    emailPrefix: string;
  }): Promise<{ userId: string; professionalProfileId: string }> {
    const { userId } = await seedUser(
      UserAccountStatus.APPROVED,
      params.emailPrefix,
    );
    const approximate = snapToGrid(params.exactCenter);
    const professionalProfile = await prisma.professionalProfile.create({
      data: {
        userId,
        displayName: `Profesional ${params.emailPrefix}`,
        city: 'CABA',
        country: CountryCode.AR,
        serviceAreaDescription: 'CABA y GBA',
        bio: 'Con experiencia.',
        verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
        serviceAreaLatitude: params.exactCenter.latitude,
        serviceAreaLongitude: params.exactCenter.longitude,
        serviceAreaRadiusKm: params.serviceAreaRadiusKm,
        approximateLatitude: approximate.latitude,
        approximateLongitude: approximate.longitude,
      },
    });
    await prisma.professionalSpecialization.createMany({
      data: params.categoryIds.map((categoryId, index) => ({
        professionalProfileId: professionalProfile.id,
        categoryId,
        role:
          index === 0
            ? SpecializationRole.PRIMARY
            : SpecializationRole.SECONDARY,
        description: 'Especialista.',
        order: index,
      })),
    });
    return { userId, professionalProfileId: professionalProfile.id };
  }

  async function seedCategories(count: number): Promise<string[]> {
    const categories = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        prisma.category.create({
          data: { name: uniqueCategoryName(`Categoria-${i}`) },
        }),
      ),
    );
    const ids = categories.map((c) => c.id);
    createdCategoryIds.push(...ids);
    return ids;
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

  function nearbyProfessionalsRequest(
    input: Record<string, unknown>,
    sessionToken?: string,
    query: string = NEARBY_PROFESSIONALS_QUERY,
  ) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables: { input } });
    if (sessionToken) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req;
  }

  it(
    'returns a nearby, willing professional; excludes one whose OWN declared ' +
      "serviceAreaRadiusKm doesn't reach the searcher; excludes one far away",
    async () => {
      const [categoryId] = await seedCategories(1);
      const { email } = await seedApprovedCustomer();
      const sessionToken = await loginSessionToken(email);

      const { professionalProfileId: nearbyId } =
        await seedApprovedProfessionalWithServiceArea({
          exactCenter: NEARBY_EXACT_CENTER,
          serviceAreaRadiusKm: 10,
          categoryIds: [categoryId],
          emailPrefix: 'nearby-willing',
        });
      await seedApprovedProfessionalWithServiceArea({
        exactCenter: NOT_WILLING_EXACT_CENTER,
        serviceAreaRadiusKm: 1,
        categoryIds: [categoryId],
        emailPrefix: 'nearby-not-willing',
      });
      await seedApprovedProfessionalWithServiceArea({
        exactCenter: FAR_EXACT_CENTER,
        serviceAreaRadiusKm: 100,
        categoryIds: [categoryId],
        emailPrefix: 'far-away',
      });

      const response = await nearbyProfessionalsRequest(
        { center: OBELISCO, radiusKm: 20 },
        sessionToken,
      ).expect(200);
      const body = response.body as NearbyProfessionalsResponseBody;

      expect(body.errors).toBeUndefined();
      const resultIds = body.data!.nearbyProfessionals.map(
        (entry) => entry.profile.id,
      );
      expect(resultIds).toContain(nearbyId);
      expect(resultIds).toHaveLength(1);
    },
  );

  it('LOCATION_REQUIRED when neither an explicit center nor a geocoded CustomerProfile address is available', async () => {
    const { email } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);

    const response = await nearbyProfessionalsRequest({}, sessionToken).expect(
      200,
    );
    const body = response.body as NearbyProfessionalsResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('LOCATION_REQUIRED');
  });

  it('UNAUTHENTICATED without a session token', async () => {
    const response = await nearbyProfessionalsRequest({
      center: OBELISCO,
    }).expect(200);
    const body = response.body as NearbyProfessionalsResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('ACCOUNT_NOT_APPROVED for a session whose account is not APPROVED', async () => {
    const { email } = await seedUser(
      UserAccountStatus.PENDING_APPROVAL,
      'discovery-pending',
    );
    const sessionToken = await loginSessionToken(email);

    const response = await nearbyProfessionalsRequest(
      { center: OBELISCO },
      sessionToken,
    ).expect(200);
    const body = response.body as NearbyProfessionalsResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ACCOUNT_NOT_APPROVED');
  });

  it('filters by categoryId, including its descendants (hierarchical matching)', async () => {
    const [parentCategoryId] = await seedCategories(1);
    const childCategory = await prisma.category.create({
      data: {
        name: uniqueCategoryName('Categoria-child'),
        parentId: parentCategoryId,
      },
    });
    createdCategoryIds.push(childCategory.id);
    const [unrelatedCategoryId] = await seedCategories(1);

    const { email } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);

    const { professionalProfileId: matchesChild } =
      await seedApprovedProfessionalWithServiceArea({
        exactCenter: NEARBY_EXACT_CENTER,
        serviceAreaRadiusKm: 10,
        categoryIds: [childCategory.id],
        emailPrefix: 'matches-child-category',
      });
    await seedApprovedProfessionalWithServiceArea({
      exactCenter: NEARBY_EXACT_CENTER,
      serviceAreaRadiusKm: 10,
      categoryIds: [unrelatedCategoryId],
      emailPrefix: 'unrelated-category',
    });

    const response = await nearbyProfessionalsRequest(
      { center: OBELISCO, radiusKm: 20, categoryId: parentCategoryId },
      sessionToken,
    ).expect(200);
    const body = response.body as NearbyProfessionalsResponseBody;

    expect(body.errors).toBeUndefined();
    const resultIds = body.data!.nearbyProfessionals.map(
      (entry) => entry.profile.id,
    );
    expect(resultIds).toEqual([matchesChild]);
  });

  describe('DEC-005 — exact Service Area coordinates never cross the boundary', () => {
    it(
      'the raw JSON response for a normal query never contains ' +
        'serviceAreaLatitude/serviceAreaLongitude anywhere, even as substrings',
      async () => {
        const [categoryId] = await seedCategories(1);
        const { email } = await seedApprovedCustomer();
        const sessionToken = await loginSessionToken(email);
        await seedApprovedProfessionalWithServiceArea({
          exactCenter: NEARBY_EXACT_CENTER,
          serviceAreaRadiusKm: 10,
          categoryIds: [categoryId],
          emailPrefix: 'dec005-normal-query',
        });

        const response = await nearbyProfessionalsRequest(
          { center: OBELISCO, radiusKm: 20 },
          sessionToken,
        ).expect(200);
        const body = response.body as NearbyProfessionalsResponseBody;

        expect(body.data!.nearbyProfessionals.length).toBeGreaterThan(0);
        const rawJson = JSON.stringify(response.body);
        expect(rawJson).not.toContain('serviceAreaLatitude');
        expect(rawJson).not.toContain('serviceAreaLongitude');
        expect(rawJson).not.toContain(String(NEARBY_EXACT_CENTER.latitude));
        expect(rawJson).not.toContain(String(NEARBY_EXACT_CENTER.longitude));
      },
    );

    it(
      'a query that explicitly ASKS for serviceAreaLatitude/serviceAreaLongitude on ' +
        'NearbyProfessional.profile is rejected by GraphQL schema validation — ' +
        'the field does not exist, a resolver cannot leak what it cannot name',
      async () => {
        const [categoryId] = await seedCategories(1);
        const { email } = await seedApprovedCustomer();
        const sessionToken = await loginSessionToken(email);
        await seedApprovedProfessionalWithServiceArea({
          exactCenter: NEARBY_EXACT_CENTER,
          serviceAreaRadiusKm: 10,
          categoryIds: [categoryId],
          emailPrefix: 'dec005-forbidden-query',
        });

        const response = await nearbyProfessionalsRequest(
          { center: OBELISCO, radiusKm: 20 },
          sessionToken,
          NEARBY_PROFESSIONALS_QUERY_WITH_FORBIDDEN_FIELDS,
        );
        const body = response.body as {
          data?: unknown;
          errors?: GraphQLErrorEntry[];
        };

        expect(body.data).toBeUndefined();
        expect(body.errors).toBeDefined();
        const messages = body.errors!.map((e) => e.message).join(' | ');
        expect(messages).toMatch(/Cannot query field/i);
        expect(messages).toContain('serviceAreaLatitude');
      },
    );
  });
});
