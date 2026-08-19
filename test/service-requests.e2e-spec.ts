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
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanProfilesData,
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const SERVICE_REQUEST_FIELDS = `
  id customerProfileId description urgency indicativeBudgetMin
  indicativeBudgetMax status createdAt updatedAt
  category { id name }
  attachments { id url createdAt }
`;

const PUBLISH_SERVICE_REQUEST_MUTATION = `
  mutation PublishServiceRequest($input: PublishServiceRequestInput!) {
    publishServiceRequest(input: $input) { ${SERVICE_REQUEST_FIELDS} }
  }
`;

const CANCEL_SERVICE_REQUEST_MUTATION = `
  mutation CancelServiceRequest($serviceRequestId: ID!) {
    cancelServiceRequest(serviceRequestId: $serviceRequestId) { ${SERVICE_REQUEST_FIELDS} }
  }
`;

const MY_PUBLISHED_SERVICE_REQUESTS_QUERY = `
  query MyPublishedServiceRequests {
    myPublishedServiceRequests { ${SERVICE_REQUEST_FIELDS} }
  }
`;

const COMPATIBLE_SERVICE_REQUESTS_QUERY = `
  query CompatibleServiceRequests {
    compatibleServiceRequests { ${SERVICE_REQUEST_FIELDS} }
  }
`;

const REQUEST_UPLOAD_URL_MUTATION = `
  mutation RequestUploadUrl($input: RequestServiceRequestAttachmentUploadUrlInput!) {
    requestServiceRequestAttachmentUploadUrl(input: $input) {
      ref uploadUrl fileUrl expiresAt
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

interface ServiceRequestPayload {
  id: string;
  customerProfileId: string;
  description: string;
  urgency: string;
  indicativeBudgetMin: number | null;
  indicativeBudgetMax: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string };
  attachments: { id: string; url: string; createdAt: string }[];
}

interface ServiceRequestResponseBody<K extends string> {
  data: Record<K, ServiceRequestPayload> | null;
  errors?: GraphQLErrorEntry[];
}

interface ListResponseBody<K extends string> {
  data: Record<K, ServiceRequestPayload[]> | null;
  errors?: GraphQLErrorEntry[];
}

interface UploadUrlResponseBody {
  data: {
    requestServiceRequestAttachmentUploadUrl: {
      ref: string;
      uploadUrl: string;
      fileUrl: string;
      expiresAt: string;
    };
  } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `service-requests-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for GOS-38 (publish/cancel/list/compatibility/attachment
 * upload) — SessionGuard/AccountApprovedGuard enforcement, ownership/IDOR
 * boundaries, category validation, and category-based Professional
 * matching. Users/CustomerProfiles/ProfessionalProfiles are seeded directly
 * via `prisma.*.create` (same "ad hoc seedX() helper, no shared factory
 * library" convention every other e2e spec in this suite already uses —
 * see `test/profiles-professional-profile.e2e-spec.ts`), including seeding
 * `accountStatus: APPROVED` directly at creation, the same shortcut
 * `test/admin-user-accounts.e2e-spec.ts` already uses to avoid having to
 * drive the full identity-verification/admin-approval flow just to test
 * something downstream of "already approved".
 */
describe('GraphQL ServiceRequest (GOS-38, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  // `login` is throttled (10/60s — see `AuthResolver`) and this file logs
  // in at least once per test, several tests twice (Customer +
  // Professional) — same "flush the Redis-backed throttle counter before
  // every test" convention `admin-user-accounts.e2e-spec.ts`/
  // `profiles-professional-profile.e2e-spec.ts` already establish, without
  // which this file alone exceeds the shared budget.
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
  });

  afterAll(async () => {
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

  async function seedApprovedCustomer(): Promise<{
    email: string;
    userId: string;
    customerProfileId: string;
  }> {
    const { email, userId } = await seedUser(UserAccountStatus.APPROVED);
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId,
        displayName: 'Cliente de Prueba',
        addressLine: 'Calle Falsa 123',
        city: 'CABA',
        province: 'Buenos Aires',
        country: CountryCode.AR,
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
        displayName: 'Profesional de Prueba',
        city: 'CABA',
        country: CountryCode.AR,
        serviceAreaDescription: 'CABA y GBA',
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

  function publishInput(
    categoryId: string,
    overrides?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      category: categoryId,
      description: 'Se rompió una cañería en la cocina y pierde agua.',
      urgency: 'URGENT',
      ...overrides,
    };
  }

  // 1. Customer APPROVED publica -> OPEN
  it('an APPROVED Customer can publish a ServiceRequest, which starts OPEN', async () => {
    const { email, customerProfileId } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);
    const [categoryId] = await seedCategories(1);

    const response = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      sessionToken,
    ).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'publishServiceRequest'>;

    expect(body.errors).toBeUndefined();
    expect(body.data?.publishServiceRequest).toMatchObject({
      customerProfileId,
      status: 'OPEN',
      urgency: 'URGENT',
      category: { id: categoryId },
    });
  });

  // 2. Customer no APPROVED publica -> rechazo
  it('a non-APPROVED Customer cannot publish -> ACCOUNT_NOT_APPROVED', async () => {
    const { email } = await seedUser(UserAccountStatus.PENDING_APPROVAL);
    const sessionToken = await loginSessionToken(email);
    const [categoryId] = await seedCategories(1);

    const response = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      sessionToken,
    ).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'publishServiceRequest'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ACCOUNT_NOT_APPROVED');
  });

  // 3. Customer ve sus solicitudes
  it("myPublishedServiceRequests returns the caller's own ServiceRequests", async () => {
    const { email } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);
    const [categoryId] = await seedCategories(1);

    await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      sessionToken,
    ).expect(200);

    const response = await gqlRequest(
      MY_PUBLISHED_SERVICE_REQUESTS_QUERY,
      {},
      sessionToken,
    ).expect(200);
    const body =
      response.body as ListResponseBody<'myPublishedServiceRequests'>;

    expect(body.data?.myPublishedServiceRequests).toHaveLength(1);
    expect(body.data?.myPublishedServiceRequests[0].category.id).toBe(
      categoryId,
    );
  });

  // 4. Customer no ve solicitudes de otro Customer
  it("myPublishedServiceRequests never leaks another Customer's rows", async () => {
    const customerA = await seedApprovedCustomer();
    const customerB = await seedApprovedCustomer();
    const tokenA = await loginSessionToken(customerA.email);
    const tokenB = await loginSessionToken(customerB.email);
    const [categoryId] = await seedCategories(1);

    await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      tokenA,
    ).expect(200);

    const response = await gqlRequest(
      MY_PUBLISHED_SERVICE_REQUESTS_QUERY,
      {},
      tokenB,
    ).expect(200);
    const body =
      response.body as ListResponseBody<'myPublishedServiceRequests'>;

    expect(body.data?.myPublishedServiceRequests).toHaveLength(0);
  });

  // 5. Customer cancela propia OPEN
  it('a Customer can cancel their own OPEN ServiceRequest', async () => {
    const { email } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);
    const [categoryId] = await seedCategories(1);

    const published = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      sessionToken,
    ).expect(200);
    const publishedBody =
      published.body as ServiceRequestResponseBody<'publishServiceRequest'>;
    const serviceRequestId = publishedBody.data!.publishServiceRequest.id;

    const response = await gqlRequest(
      CANCEL_SERVICE_REQUEST_MUTATION,
      { serviceRequestId },
      sessionToken,
    ).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'cancelServiceRequest'>;

    expect(body.data?.cancelServiceRequest.status).toBe('CANCELLED');
  });

  // 6. Customer intenta cancelar ajena -> rechazo
  it("a Customer cannot cancel another Customer's ServiceRequest -> SERVICE_REQUEST_NOT_FOUND", async () => {
    const owner = await seedApprovedCustomer();
    const attacker = await seedApprovedCustomer();
    const ownerToken = await loginSessionToken(owner.email);
    const attackerToken = await loginSessionToken(attacker.email);
    const [categoryId] = await seedCategories(1);

    const published = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      ownerToken,
    ).expect(200);
    const publishedBody =
      published.body as ServiceRequestResponseBody<'publishServiceRequest'>;
    const serviceRequestId = publishedBody.data!.publishServiceRequest.id;

    const response = await gqlRequest(
      CANCEL_SERVICE_REQUEST_MUTATION,
      { serviceRequestId },
      attackerToken,
    ).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'cancelServiceRequest'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'SERVICE_REQUEST_NOT_FOUND',
    );
  });

  // 7. Customer intenta cancelar ya CANCELLED
  it('cancelling an already-CANCELLED ServiceRequest -> SERVICE_REQUEST_ALREADY_CANCELLED', async () => {
    const { email } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);
    const [categoryId] = await seedCategories(1);

    const published = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      sessionToken,
    ).expect(200);
    const publishedBody =
      published.body as ServiceRequestResponseBody<'publishServiceRequest'>;
    const serviceRequestId = publishedBody.data!.publishServiceRequest.id;

    await gqlRequest(
      CANCEL_SERVICE_REQUEST_MUTATION,
      { serviceRequestId },
      sessionToken,
    ).expect(200);

    const response = await gqlRequest(
      CANCEL_SERVICE_REQUEST_MUTATION,
      { serviceRequestId },
      sessionToken,
    ).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'cancelServiceRequest'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'SERVICE_REQUEST_ALREADY_CANCELLED',
    );
  });

  // 8. Professional APPROVED ve solicitudes compatibles
  // 9. Professional no ve solicitudes de otras categorías
  // 14. múltiples categorías de Professional
  it("compatibleServiceRequests returns OPEN requests only in the professional's own categories", async () => {
    const [electricidad, plomeria, pintura] = await seedCategories(3);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const professional = await seedApprovedProfessional([
      electricidad,
      plomeria,
    ]);
    const professionalToken = await loginSessionToken(professional.email);

    await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(electricidad) },
      customerToken,
    ).expect(200);
    await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(plomeria) },
      customerToken,
    ).expect(200);
    await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(pintura) },
      customerToken,
    ).expect(200);

    const response = await gqlRequest(
      COMPATIBLE_SERVICE_REQUESTS_QUERY,
      {},
      professionalToken,
    ).expect(200);
    const body = response.body as ListResponseBody<'compatibleServiceRequests'>;

    const returnedCategoryIds = body.data!.compatibleServiceRequests.map(
      (sr) => sr.category.id,
    );
    expect(new Set(returnedCategoryIds)).toEqual(
      new Set([electricidad, plomeria]),
    );
    expect(returnedCategoryIds).not.toContain(pintura);
  });

  // 15/16. ServiceRequest OPEN visible, CANCELLED no visible
  it('compatibleServiceRequests excludes CANCELLED requests', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const published = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      customerToken,
    ).expect(200);
    const publishedBody =
      published.body as ServiceRequestResponseBody<'publishServiceRequest'>;
    await gqlRequest(
      CANCEL_SERVICE_REQUEST_MUTATION,
      { serviceRequestId: publishedBody.data!.publishServiceRequest.id },
      customerToken,
    ).expect(200);

    const response = await gqlRequest(
      COMPATIBLE_SERVICE_REQUESTS_QUERY,
      {},
      professionalToken,
    ).expect(200);
    const body = response.body as ListResponseBody<'compatibleServiceRequests'>;

    expect(body.data?.compatibleServiceRequests).toHaveLength(0);
  });

  // Category-tree follow-up (2026-08-18) — hierarchical matching: a
  // Professional specialized in a PARENT Category is compatible with
  // ServiceRequests posted under any of its CHILD Categories too.
  it('compatibleServiceRequests includes child-category requests for a professional specialized in the PARENT category', async () => {
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
    const professional = await seedApprovedProfessional([parentCategoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(child.id) },
      customerToken,
    ).expect(200);

    const response = await gqlRequest(
      COMPATIBLE_SERVICE_REQUESTS_QUERY,
      {},
      professionalToken,
    ).expect(200);
    const body = response.body as ListResponseBody<'compatibleServiceRequests'>;

    expect(
      body.data!.compatibleServiceRequests.map((sr) => sr.category.id),
    ).toContain(child.id);
  });

  // Category-tree follow-up (2026-08-18) — the REVERSE direction is NOT
  // implemented: specializing in a CHILD Category does not make a
  // Professional compatible with its PARENT's own ServiceRequests.
  it('compatibleServiceRequests does NOT include parent-category requests for a professional specialized only in a CHILD category', async () => {
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
    const professional = await seedApprovedProfessional([child.id]);
    const professionalToken = await loginSessionToken(professional.email);

    await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(parentCategoryId) },
      customerToken,
    ).expect(200);

    const response = await gqlRequest(
      COMPATIBLE_SERVICE_REQUESTS_QUERY,
      {},
      professionalToken,
    ).expect(200);
    const body = response.body as ListResponseBody<'compatibleServiceRequests'>;

    expect(
      body.data!.compatibleServiceRequests.map((sr) => sr.category.id),
    ).not.toContain(parentCategoryId);
  });

  // 10. Professional no puede cancelar (no tiene CustomerProfile -> ownership check falla)
  it('a Professional cannot cancel a ServiceRequest (no CustomerProfile of their own)', async () => {
    const [categoryId] = await seedCategories(1);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const published = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId) },
      customerToken,
    ).expect(200);
    const publishedBody =
      published.body as ServiceRequestResponseBody<'publishServiceRequest'>;

    const response = await gqlRequest(
      CANCEL_SERVICE_REQUEST_MUTATION,
      { serviceRequestId: publishedBody.data!.publishServiceRequest.id },
      professionalToken,
    ).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'cancelServiceRequest'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'CUSTOMER_PROFILE_REQUIRED',
    );
  });

  // 11. Usuario no APPROVED no puede consultar operaciones protegidas
  it('a non-APPROVED user cannot query myPublishedServiceRequests/compatibleServiceRequests', async () => {
    const { email } = await seedUser(UserAccountStatus.PENDING_APPROVAL);
    const sessionToken = await loginSessionToken(email);

    const myResponse = await gqlRequest(
      MY_PUBLISHED_SERVICE_REQUESTS_QUERY,
      {},
      sessionToken,
    ).expect(200);
    const myBody =
      myResponse.body as ListResponseBody<'myPublishedServiceRequests'>;
    expect(myBody.errors?.[0]?.extensions?.code).toBe('ACCOUNT_NOT_APPROVED');

    const compatibleResponse = await gqlRequest(
      COMPATIBLE_SERVICE_REQUESTS_QUERY,
      {},
      sessionToken,
    ).expect(200);
    const compatibleBody =
      compatibleResponse.body as ListResponseBody<'compatibleServiceRequests'>;
    expect(compatibleBody.errors?.[0]?.extensions?.code).toBe(
      'ACCOUNT_NOT_APPROVED',
    );
  });

  // 12. Category inexistente
  it('publishing with a nonexistent category -> CATEGORY_NOT_FOUND', async () => {
    const { email } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);
    const nonexistentId = '00000000-0000-4000-8000-000000000000';

    const response = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(nonexistentId) },
      sessionToken,
    ).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'publishServiceRequest'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_NOT_FOUND');
  });

  // 13. Attachment ref inválido
  it('publishing with an invalid attachmentUploadRef -> INVALID_ATTACHMENT_UPLOAD_REF', async () => {
    const { email } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);
    const [categoryId] = await seedCategories(1);
    const nonexistentRef = '00000000-0000-4000-8000-000000000001';

    const response = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      {
        input: publishInput(categoryId, {
          attachmentUploadRefs: [nonexistentRef],
        }),
      },
      sessionToken,
    ).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'publishServiceRequest'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'INVALID_ATTACHMENT_UPLOAD_REF',
    );
  });

  // Full attachment round-trip: request an upload slot, PUT real bytes to
  // the returned uploadUrl, then publish referencing it, and confirm the
  // resulting ServiceRequestAttachment.url is fetchable and returns the
  // same bytes — exercises the real LocalDevStorageAdapter/UploadsController,
  // not a mock.
  it('requestServiceRequestAttachmentUploadUrl + publishServiceRequest round-trips a real file', async () => {
    const { email } = await seedApprovedCustomer();
    const sessionToken = await loginSessionToken(email);
    const [categoryId] = await seedCategories(1);

    const uploadUrlResponse = await gqlRequest(
      REQUEST_UPLOAD_URL_MUTATION,
      { input: { fileName: 'foto.jpg', contentType: 'image/jpeg' } },
      sessionToken,
    ).expect(200);
    const uploadUrlBody = uploadUrlResponse.body as UploadUrlResponseBody;
    expect(uploadUrlBody.errors).toBeUndefined();
    const { ref, uploadUrl, fileUrl } =
      uploadUrlBody.data!.requestServiceRequestAttachmentUploadUrl;

    const fileBytes = Buffer.from('fake-jpeg-bytes');
    const uploadPath = uploadUrl.replace(/^https?:\/\/[^/]+/, '');
    await request(app.getHttpServer())
      .put(uploadPath)
      .set('Content-Type', 'image/jpeg')
      .send(fileBytes)
      .expect(200);

    const published = await gqlRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      { input: publishInput(categoryId, { attachmentUploadRefs: [ref] }) },
      sessionToken,
    ).expect(200);
    const publishedBody =
      published.body as ServiceRequestResponseBody<'publishServiceRequest'>;
    expect(publishedBody.errors).toBeUndefined();
    expect(publishedBody.data?.publishServiceRequest.attachments).toEqual([
      expect.objectContaining({ url: fileUrl }),
    ]);

    const fetchPath = fileUrl.replace(/^https?:\/\/[^/]+/, '');
    const getResponse = await request(app.getHttpServer())
      .get(fetchPath)
      .expect(200);
    expect(Buffer.compare(getResponse.body as Buffer, fileBytes)).toBe(0);
  });

  it('publishServiceRequest without an Authorization header -> UNAUTHENTICATED', async () => {
    const [categoryId] = await seedCategories(1);

    const response = await gqlRequest(PUBLISH_SERVICE_REQUEST_MUTATION, {
      input: publishInput(categoryId),
    }).expect(200);
    const body =
      response.body as ServiceRequestResponseBody<'publishServiceRequest'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
