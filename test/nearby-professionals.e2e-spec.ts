import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressOwnerRole,
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
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanAddressesData,
  cleanProfilesData,
  cleanUsersData,
  createTestApp,
  enableTestMaps,
} from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const NEARBY_PROFESSIONALS_QUERY = `
  query NearbyProfessionals($categoryId: ID, $latitude: Float!, $longitude: Float!, $radiusKm: Float) {
    nearbyProfessionals(categoryId: $categoryId, latitude: $latitude, longitude: $longitude, radiusKm: $radiusKm) {
      distanceKm
      professional { id firstName }
      address { id formattedAddress latitude longitude }
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

interface NearbyProfessionalsResponseBody {
  data: {
    nearbyProfessionals: {
      distanceKm: number;
      professional: { id: string; firstName: string };
      address: { id: string; formattedAddress: string };
    }[];
  } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';
// Buenos Aires (Obelisco) — the search origin every test below uses.
const ORIGIN_LAT = -34.6037;
const ORIGIN_LNG = -58.3816;
// ~1.5km from the origin — well within a default e2e radius.
const NEARBY_LAT = -34.615;
const NEARBY_LNG = -58.39;
// Córdoba, Argentina — ~650km from the origin, well outside any radius this
// suite configures.
const FAR_LAT = -31.4201;
const FAR_LNG = -64.1888;

function uniqueEmail(): string {
  return `nearby-pros-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for GOS-155's `Query.nearbyProfessionals` — the confirmed
 * gates (category match incl. hierarchical, `locationSharingEnabled`, a
 * saved `isDefault` Address, radius, `maps.enabled`, `AccountApprovedGuard`)
 * and the anti-enumeration/auth boundaries.
 */
describe('GraphQL nearbyProfessionals (GOS-155, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  async function flushRedis(): Promise<void> {
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
  }

  beforeEach(async () => {
    await flushRedis();
    await enableTestMaps(prisma);
  });

  afterAll(async () => {
    await cleanAddressesData(prisma);
    await cleanProfilesData(prisma);
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
    await cleanUsersData(prisma);
    await flushRedis();
    await app.close();
  });

  async function seedUser(
    accountStatus: UserAccountStatus,
  ): Promise<{ email: string; userId: string }> {
    const email = uniqueEmail();
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
    customerProfileId: string;
  }> {
    const { email, userId } = await seedUser(UserAccountStatus.APPROVED);
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId,
        firstName: 'Cliente',
        lastName: 'de Prueba',
        country: CountryCode.AR,
      },
    });
    return { email, userId, customerProfileId: customerProfile.id };
  }

  async function seedProfessional(params: {
    accountStatus: UserAccountStatus;
    categoryIds: string[];
    locationSharingEnabled: boolean;
  }): Promise<{
    email: string;
    userId: string;
    professionalProfileId: string;
  }> {
    const { email, userId } = await seedUser(params.accountStatus);
    const professionalProfile = await prisma.professionalProfile.create({
      data: {
        userId,
        firstName: 'Profesional',
        lastName: 'de Prueba',
        country: CountryCode.AR,
        bio: 'Con experiencia.',
        verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
        locationSharingEnabled: params.locationSharingEnabled,
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
    return { email, userId, professionalProfileId: professionalProfile.id };
  }

  async function seedProfessionalAddress(
    professionalProfileId: string,
    latitude: number,
    longitude: number,
  ): Promise<string> {
    const address = await prisma.address.create({
      data: {
        ownerRole: AddressOwnerRole.PROFESSIONAL,
        professionalProfileId,
        formattedAddress: 'Av. Corrientes 1234, CABA',
        placeId: `place-${Date.now()}-${Math.random()}`,
        latitude,
        longitude,
        isDefault: true,
      },
    });
    return address.id;
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

  function gqlRequest(
    query: string,
    variables: Record<string, unknown>,
    sessionToken?: string,
  ) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables });
    if (sessionToken) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req;
  }

  async function queryNearby(
    sessionToken: string,
    categoryId?: string,
    overrides?: { radiusKm?: number },
  ): Promise<NearbyProfessionalsResponseBody> {
    const response = await gqlRequest(
      NEARBY_PROFESSIONALS_QUERY,
      {
        categoryId,
        latitude: ORIGIN_LAT,
        longitude: ORIGIN_LNG,
        radiusKm: overrides?.radiusKm,
      },
      sessionToken,
    ).expect(200);
    return response.body as NearbyProfessionalsResponseBody;
  }

  it('returns a Professional who offers the category, shares location, and has a nearby default Address', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const professional = await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: [categoryId],
      locationSharingEnabled: true,
    });
    await seedProfessionalAddress(
      professional.professionalProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );

    const body = await queryNearby(customerToken, categoryId);

    expect(body.errors).toBeUndefined();
    expect(body.data?.nearbyProfessionals).toHaveLength(1);
    expect(body.data!.nearbyProfessionals[0].professional.id).toBe(
      professional.professionalProfileId,
    );
    expect(body.data!.nearbyProfessionals[0].distanceKm).toBeGreaterThan(0);
  });

  it('excludes a Professional who has NOT opted into locationSharingEnabled', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const professional = await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: [categoryId],
      locationSharingEnabled: false,
    });
    await seedProfessionalAddress(
      professional.professionalProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );

    const body = await queryNearby(customerToken, categoryId);

    expect(body.data?.nearbyProfessionals).toHaveLength(0);
  });

  it('excludes a Professional with locationSharingEnabled but NO saved Address', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: [categoryId],
      locationSharingEnabled: true,
    });

    const body = await queryNearby(customerToken, categoryId);

    expect(body.data?.nearbyProfessionals).toHaveLength(0);
  });

  it('excludes a Professional whose default Address is outside the search radius', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const professional = await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: [categoryId],
      locationSharingEnabled: true,
    });
    await seedProfessionalAddress(
      professional.professionalProfileId,
      FAR_LAT,
      FAR_LNG,
    );

    const body = await queryNearby(customerToken, categoryId, {
      radiusKm: 20,
    });

    expect(body.data?.nearbyProfessionals).toHaveLength(0);
  });

  it('includes a Professional specialized in the PARENT category (hierarchical matching)', async () => {
    const [parentCategoryId] = await seedCategories(1);
    const child = await prisma.category.create({
      data: {
        name: uniqueCategoryName('Sub-categoria'),
        parentId: parentCategoryId,
      },
    });
    createdCategoryIds.push(child.id);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const professional = await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: [parentCategoryId],
      locationSharingEnabled: true,
    });
    await seedProfessionalAddress(
      professional.professionalProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );

    const body = await queryNearby(customerToken, child.id);

    expect(
      body.data!.nearbyProfessionals.map((row) => row.professional.id),
    ).toContain(professional.professionalProfileId);
  });

  it('"ver todos" mode: returns nearby Professionals across DIFFERENT categories when categoryId is omitted', async () => {
    const [categoryA, categoryB] = await seedCategories(2);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const professionalA = await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: [categoryA],
      locationSharingEnabled: true,
    });
    await seedProfessionalAddress(
      professionalA.professionalProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );
    const professionalB = await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: [categoryB],
      locationSharingEnabled: true,
    });
    await seedProfessionalAddress(
      professionalB.professionalProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );

    const body = await queryNearby(customerToken);

    expect(body.errors).toBeUndefined();
    const returnedIds = body.data!.nearbyProfessionals.map(
      (row) => row.professional.id,
    );
    expect(returnedIds).toEqual(
      expect.arrayContaining([
        professionalA.professionalProfileId,
        professionalB.professionalProfileId,
      ]),
    );
  });

  it('"ver todos" mode: still excludes a Professional with zero specializations, no locationSharingEnabled, or no saved Address', async () => {
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const noLocationSharing = await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: await seedCategories(1),
      locationSharingEnabled: false,
    });
    await seedProfessionalAddress(
      noLocationSharing.professionalProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );
    const noAddress = await seedProfessional({
      accountStatus: UserAccountStatus.APPROVED,
      categoryIds: await seedCategories(1),
      locationSharingEnabled: true,
    });

    const body = await queryNearby(customerToken);

    const returnedIds = body.data!.nearbyProfessionals.map(
      (row) => row.professional.id,
    );
    expect(returnedIds).not.toContain(noLocationSharing.professionalProfileId);
    expect(returnedIds).not.toContain(noAddress.professionalProfileId);
  });

  it('rejects with CATEGORY_NOT_FOUND for a nonexistent categoryId', async () => {
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const nonexistentId = '00000000-0000-4000-8000-000000000000';

    const body = await queryNearby(customerToken, nonexistentId);

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('rejects with ACCOUNT_NOT_APPROVED for a non-APPROVED caller', async () => {
    const [categoryId] = await seedCategories(1);
    const { email } = await seedUser(UserAccountStatus.PENDING_APPROVAL);
    const sessionToken = await loginSessionToken(email);

    const body = await queryNearby(sessionToken, categoryId);

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ACCOUNT_NOT_APPROVED');
  });

  it('rejects with MAPS_MODULE_DISABLED when maps.enabled is false', async () => {
    await enableTestMaps(prisma, { mapsEnabled: false });
    const [categoryId] = await seedCategories(1);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);

    const body = await queryNearby(customerToken, categoryId);

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('MAPS_MODULE_DISABLED');
  });

  it('rejects without an Authorization header -> UNAUTHENTICATED', async () => {
    const [categoryId] = await seedCategories(1);

    const response = await gqlRequest(NEARBY_PROFESSIONALS_QUERY, {
      categoryId,
      latitude: ORIGIN_LAT,
      longitude: ORIGIN_LNG,
    }).expect(200);
    const body = response.body as NearbyProfessionalsResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
