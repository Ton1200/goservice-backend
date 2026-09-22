import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressOwnerRole,
  AuthProvider,
  CountryCode,
  ProfessionalVerificationStatus,
  ServiceRequestStatus,
  ServiceRequestUrgency,
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
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
  enableTestMaps,
} from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const NEARBY_SERVICE_REQUESTS_QUERY = `
  query NearbyServiceRequests($latitude: Float!, $longitude: Float!, $radiusKm: Float) {
    nearbyServiceRequests(latitude: $latitude, longitude: $longitude, radiusKm: $radiusKm) {
      distanceKm
      serviceRequest { id status addressId }
      address { id formattedAddress }
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

interface NearbyServiceRequestsResponseBody {
  data: {
    nearbyServiceRequests: {
      distanceKm: number;
      serviceRequest: { id: string; status: string; addressId: string | null };
      address: { id: string; formattedAddress: string };
    }[];
  } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';
const ORIGIN_LAT = -34.6037;
const ORIGIN_LNG = -58.3816;
const NEARBY_LAT = -34.615;
const NEARBY_LNG = -58.39;
const FAR_LAT = -31.4201;
const FAR_LNG = -64.1888;

function uniqueEmail(): string {
  return `nearby-srs-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for GOS-155's `Query.nearbyServiceRequests` — the confirmed
 * gates (hierarchical category match, `status = OPEN`, a non-null
 * `addressId`, the owning Customer's `locationSharingEnabled`, radius,
 * `maps.enabled`, `AccountApprovedGuard`) and the anti-enumeration/auth
 * boundaries.
 */
describe('GraphQL nearbyServiceRequests (GOS-155, e2e)', () => {
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
    await cleanServiceRequestsData(prisma);
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

  async function seedCustomer(
    locationSharingEnabled: boolean,
  ): Promise<{ email: string; userId: string; customerProfileId: string }> {
    const { email, userId } = await seedUser(UserAccountStatus.APPROVED);
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId,
        firstName: 'Cliente',
        lastName: 'de Prueba',
        country: CountryCode.AR,
        locationSharingEnabled,
      },
    });
    return { email, userId, customerProfileId: customerProfile.id };
  }

  async function seedApprovedProfessional(
    categoryIds: string[],
  ): Promise<{ email: string; userId: string; professionalProfileId: string }> {
    const { email, userId } = await seedUser(UserAccountStatus.APPROVED);
    const professionalProfile = await prisma.professionalProfile.create({
      data: {
        userId,
        firstName: 'Profesional',
        lastName: 'de Prueba',
        country: CountryCode.AR,
        bio: 'Con experiencia.',
        verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
      },
    });
    await prisma.professionalSpecialization.createMany({
      data: categoryIds.map((categoryId, index) => ({
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

  async function seedCustomerAddress(
    customerProfileId: string,
    latitude: number,
    longitude: number,
  ): Promise<string> {
    const address = await prisma.address.create({
      data: {
        ownerRole: AddressOwnerRole.CUSTOMER,
        customerProfileId,
        formattedAddress: 'Av. Corrientes 1234, CABA',
        placeId: `place-${Date.now()}-${Math.random()}`,
        latitude,
        longitude,
        isDefault: true,
      },
    });
    return address.id;
  }

  async function seedServiceRequest(params: {
    customerProfileId: string;
    categoryId: string;
    addressId: string | null;
    status?: ServiceRequestStatus;
  }): Promise<string> {
    const serviceRequest = await prisma.serviceRequest.create({
      data: {
        customerProfileId: params.customerProfileId,
        categoryId: params.categoryId,
        description: 'Se rompió una cañería en la cocina.',
        urgency: ServiceRequestUrgency.URGENT,
        addressId: params.addressId,
        status: params.status ?? ServiceRequestStatus.OPEN,
      },
    });
    return serviceRequest.id;
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
    overrides?: { radiusKm?: number },
  ): Promise<NearbyServiceRequestsResponseBody> {
    const response = await gqlRequest(
      NEARBY_SERVICE_REQUESTS_QUERY,
      {
        latitude: ORIGIN_LAT,
        longitude: ORIGIN_LNG,
        radiusKm: overrides?.radiusKm,
      },
      sessionToken,
    ).expect(200);
    return response.body as NearbyServiceRequestsResponseBody;
  }

  it('returns an OPEN ServiceRequest matching category, address-in-radius, and locationSharingEnabled', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedCustomer(true);
    const addressId = await seedCustomerAddress(
      customer.customerProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );
    const serviceRequestId = await seedServiceRequest({
      customerProfileId: customer.customerProfileId,
      categoryId,
      addressId,
    });
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const body = await queryNearby(professionalToken);

    expect(body.errors).toBeUndefined();
    expect(body.data?.nearbyServiceRequests).toHaveLength(1);
    expect(body.data!.nearbyServiceRequests[0].serviceRequest.id).toBe(
      serviceRequestId,
    );
  });

  it('excludes a ServiceRequest whose owning Customer has NOT opted into locationSharingEnabled', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedCustomer(false);
    const addressId = await seedCustomerAddress(
      customer.customerProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );
    await seedServiceRequest({
      customerProfileId: customer.customerProfileId,
      categoryId,
      addressId,
    });
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const body = await queryNearby(professionalToken);

    expect(body.data?.nearbyServiceRequests).toHaveLength(0);
  });

  it('excludes a ServiceRequest with a null addressId (published before the column existed)', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedCustomer(true);
    await seedServiceRequest({
      customerProfileId: customer.customerProfileId,
      categoryId,
      addressId: null,
    });
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const body = await queryNearby(professionalToken);

    expect(body.data?.nearbyServiceRequests).toHaveLength(0);
  });

  it('excludes a CANCELLED ServiceRequest', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedCustomer(true);
    const addressId = await seedCustomerAddress(
      customer.customerProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );
    await seedServiceRequest({
      customerProfileId: customer.customerProfileId,
      categoryId,
      addressId,
      status: ServiceRequestStatus.CANCELLED,
    });
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const body = await queryNearby(professionalToken);

    expect(body.data?.nearbyServiceRequests).toHaveLength(0);
  });

  it("excludes a ServiceRequest whose Address is outside the caller's search radius", async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedCustomer(true);
    const addressId = await seedCustomerAddress(
      customer.customerProfileId,
      FAR_LAT,
      FAR_LNG,
    );
    await seedServiceRequest({
      customerProfileId: customer.customerProfileId,
      categoryId,
      addressId,
    });
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const body = await queryNearby(professionalToken, { radiusKm: 20 });

    expect(body.data?.nearbyServiceRequests).toHaveLength(0);
  });

  it("excludes a ServiceRequest outside the professional's own categories", async () => {
    const [categoryA, categoryB] = await seedCategories(2);
    const customer = await seedCustomer(true);
    const addressId = await seedCustomerAddress(
      customer.customerProfileId,
      NEARBY_LAT,
      NEARBY_LNG,
    );
    await seedServiceRequest({
      customerProfileId: customer.customerProfileId,
      categoryId: categoryA,
      addressId,
    });
    const professional = await seedApprovedProfessional([categoryB]);
    const professionalToken = await loginSessionToken(professional.email);

    const body = await queryNearby(professionalToken);

    expect(body.data?.nearbyServiceRequests).toHaveLength(0);
  });

  it('returns an empty array (never an error) for a Professional with no ProfessionalProfile specializations', async () => {
    const { email } = await seedUser(UserAccountStatus.APPROVED);
    await prisma.professionalProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id,
        firstName: 'Profesional',
        lastName: 'Sin especialidad',
        country: CountryCode.AR,
        bio: 'Recién registrado.',
        verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
      },
    });
    const sessionToken = await loginSessionToken(email);

    const body = await queryNearby(sessionToken);

    expect(body.errors).toBeUndefined();
    expect(body.data?.nearbyServiceRequests).toEqual([]);
  });

  it('rejects with ACCOUNT_NOT_APPROVED for a non-APPROVED caller', async () => {
    const { email } = await seedUser(UserAccountStatus.PENDING_APPROVAL);
    const sessionToken = await loginSessionToken(email);

    const body = await queryNearby(sessionToken);

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ACCOUNT_NOT_APPROVED');
  });

  it('rejects with MAPS_MODULE_DISABLED when maps.enabled is false', async () => {
    await enableTestMaps(prisma, { mapsEnabled: false });
    const [categoryId] = await seedCategories(1);
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const body = await queryNearby(professionalToken);

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('MAPS_MODULE_DISABLED');
  });

  it('rejects without an Authorization header -> UNAUTHENTICATED', async () => {
    const response = await gqlRequest(NEARBY_SERVICE_REQUESTS_QUERY, {
      latitude: ORIGIN_LAT,
      longitude: ORIGIN_LNG,
    }).expect(200);
    const body = response.body as NearbyServiceRequestsResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
