import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminUserStatus,
  AuthProvider,
  CountryCode,
  Permission,
  ProfessionalVerificationStatus,
  ServiceRequestUrgency,
  UserAccountStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanAdminUsersData,
  cleanProfilesData,
  cleanQuotesAndEngagementsData,
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
  }
`;

const QUOTES_QUERY = `
  query Quotes($limit: Int, $offset: Int) {
    quotes(limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        price
        message
        status
        serviceRequest {
          id
          description
          status
          category { id name }
          customerProfile { id userId displayName email }
        }
        professional { id userId displayName email }
      }
    }
  }
`;

const QUOTE_DETAIL_QUERY = `
  query QuoteDetail($id: ID!) {
    quoteDetail(id: $id) {
      id
      price
      message
      status
      serviceRequest {
        id
        description
        customerProfile { userId email }
      }
      professional { userId email }
      engagement { id status createdAt }
    }
  }
`;

const PASSWORD = 'super-secret-1';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for `quotes`/`quoteDetail` (Quotes admin grid follow-up,
 * 2026-08-19, mirroring `admin-service-requests.e2e-spec.ts`'s own
 * structure) — QUOTES_READ permission enforcement, the ServiceRequest/
 * Customer/Professional relations surfaced on every row, and the detail
 * view's linked Engagement (present only when the Quote was accepted).
 * READ-ONLY grid — no create-mutation cases exist here, unlike Service
 * Requests (see `AdminQuotesResolver`'s own header comment for why).
 */
describe('GraphQL /admin/graphql — quotes/quoteDetail (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  // Same "flush the Redis-backed throttle counter before every test"
  // convention `admin-service-requests.e2e-spec.ts` already establishes —
  // `adminLogin` is tightly throttled (5/60s) and this file logs in an
  // admin per test.
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
    await cleanQuotesAndEngagementsData(prisma);
    await cleanServiceRequestsData(prisma);
    await cleanProfilesData(prisma);
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
    await cleanUsersData(prisma);
    await cleanAdminUsersData(prisma);
    await flushRedis();
    await app.close();
  });

  async function seedAdminWithRole(
    roleName: string,
    permissions: Permission[],
  ) {
    const role = await prisma.adminRole.upsert({
      where: { name: roleName },
      update: { permissions },
      create: { name: roleName, permissions },
    });
    const email = uniqueEmail(roleName.toLowerCase());
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await prisma.adminUser.create({
      data: {
        email,
        displayName: `E2E ${roleName}`,
        passwordHash,
        roleId: role.id,
        status: AdminUserStatus.ACTIVE,
      },
    });
    return { email };
  }

  async function loginAndGetToken(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({
        query: ADMIN_LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    return (response.body as { data: { adminLogin: { sessionToken: string } } })
      .data.adminLogin.sessionToken;
  }

  function adminGraphqlRequest(
    token: string,
    query: string,
    variables?: unknown,
  ) {
    return request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query, variables })
      .set('Authorization', `Bearer ${token}`);
  }

  async function seedCategory(): Promise<string> {
    const category = await prisma.category.create({
      data: { name: uniqueCategoryName('Categoria') },
    });
    createdCategoryIds.push(category.id);
    return category.id;
  }

  async function seedCustomer(): Promise<{
    userId: string;
    userEmail: string;
    customerProfileId: string;
  }> {
    const userEmail = uniqueEmail('consumer');
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        firstName: 'Juan',
        lastName: 'Perez',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.APPROVED,
      },
    });
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId: user.id,
        displayName: 'Juan Perez',
        addressLine: 'Calle Falsa 123',
        city: 'CABA',
        province: 'Buenos Aires',
        country: CountryCode.AR,
      },
    });
    return {
      userId: user.id,
      userEmail,
      customerProfileId: customerProfile.id,
    };
  }

  async function seedProfessional(): Promise<{
    userId: string;
    userEmail: string;
    professionalProfileId: string;
  }> {
    const userEmail = uniqueEmail('professional');
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        firstName: 'Carlos',
        lastName: 'Gomez',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.APPROVED,
      },
    });
    const professionalProfile = await prisma.professionalProfile.create({
      data: {
        userId: user.id,
        displayName: 'Carlos Gomez',
        city: 'CABA',
        country: CountryCode.AR,
        serviceAreaDescription: 'CABA y GBA',
        bio: 'Con experiencia.',
        verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
      },
    });
    return {
      userId: user.id,
      userEmail,
      professionalProfileId: professionalProfile.id,
    };
  }

  /**
   * Seeds a full Customer -> ServiceRequest -> Professional -> Quote chain,
   * optionally accepting the Quote (creating a real Engagement, exercising
   * `quoteDetail`'s `engagement` field) — `accept: true` mirrors exactly
   * what `AcceptQuoteService`'s transaction does, done directly via Prisma
   * here since this suite only exercises the ADMIN read surface, not the
   * consumer accept flow itself (already covered by `quotes.e2e-spec.ts`).
   */
  async function seedQuote(options: {
    categoryId: string;
    accept?: boolean;
  }): Promise<{
    quoteId: string;
    serviceRequestId: string;
    customerEmail: string;
    professionalEmail: string;
    engagementId: string | null;
  }> {
    const customer = await seedCustomer();
    const professional = await seedProfessional();
    const serviceRequest = await prisma.serviceRequest.create({
      data: {
        customerProfileId: customer.customerProfileId,
        categoryId: options.categoryId,
        description: 'Se rompió una cañería en la cocina.',
        urgency: ServiceRequestUrgency.URGENT,
      },
    });
    const quote = await prisma.quote.create({
      data: {
        serviceRequestId: serviceRequest.id,
        professionalProfileId: professional.professionalProfileId,
        price: 15000,
        message: 'Puedo hacerlo el jueves.',
      },
    });

    let engagementId: string | null = null;
    if (options.accept) {
      await prisma.$transaction(async (tx) => {
        await tx.serviceRequest.update({
          where: { id: serviceRequest.id },
          data: { status: 'ENGAGED', acceptedQuoteId: quote.id },
        });
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
        const engagement = await tx.engagement.create({
          data: {
            serviceRequestId: serviceRequest.id,
            quoteId: quote.id,
            customerProfileId: customer.customerProfileId,
            professionalProfileId: professional.professionalProfileId,
          },
        });
        engagementId = engagement.id;
      });
    }

    return {
      quoteId: quote.id,
      serviceRequestId: serviceRequest.id,
      customerEmail: customer.userEmail,
      professionalEmail: professional.userEmail,
      engagementId,
    };
  }

  it('SUPER_ADMIN (QUOTES_READ) lists Quotes including the ServiceRequest/customer/professional relations', async () => {
    const categoryId = await seedCategory();
    const { quoteId, customerEmail, professionalEmail } = await seedQuote({
      categoryId,
    });
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_QUOTES_SUPER_ADMIN',
      [Permission.QUOTES_READ],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, QUOTES_QUERY, {
      limit: 200,
      offset: 0,
    }).expect(200);
    const body = response.body as {
      data: {
        quotes: {
          totalCount: number;
          items: {
            id: string;
            status: string;
            serviceRequest: { customerProfile: { email: string } };
            professional: { email: string };
          }[];
        };
      };
      errors?: unknown[];
    };

    expect(body.errors).toBeUndefined();
    const row = body.data.quotes.items.find((item) => item.id === quoteId);
    expect(row).toBeDefined();
    expect(row?.status).toBe('SENT');
    expect(row?.serviceRequest.customerProfile.email).toBe(customerEmail);
    expect(row?.professional.email).toBe(professionalEmail);
  });

  it('quoteDetail returns the full detail, with engagement null when the Quote was never accepted', async () => {
    const categoryId = await seedCategory();
    const { quoteId, customerEmail } = await seedQuote({ categoryId });
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_QUOTES_SUPER_ADMIN',
      [Permission.QUOTES_READ],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, QUOTE_DETAIL_QUERY, {
      id: quoteId,
    }).expect(200);
    const body = response.body as {
      data: {
        quoteDetail: {
          id: string;
          serviceRequest: { customerProfile: { email: string } };
          engagement: unknown;
        };
      };
      errors?: unknown[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.quoteDetail.serviceRequest.customerProfile.email).toBe(
      customerEmail,
    );
    expect(body.data.quoteDetail.engagement).toBeNull();
  });

  it('quoteDetail includes the linked Engagement when the Quote was accepted', async () => {
    const categoryId = await seedCategory();
    const { quoteId, engagementId } = await seedQuote({
      categoryId,
      accept: true,
    });
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_QUOTES_SUPER_ADMIN',
      [Permission.QUOTES_READ],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, QUOTE_DETAIL_QUERY, {
      id: quoteId,
    }).expect(200);
    const body = response.body as {
      data: {
        quoteDetail: { engagement: { id: string; status: string } | null };
      };
      errors?: unknown[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.quoteDetail.engagement?.id).toBe(engagementId);
    expect(body.data.quoteDetail.engagement?.status).toBe('ACCEPTED');
  });

  it('quoteDetail for a nonexistent id -> ADMIN_QUOTE_NOT_FOUND', async () => {
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_QUOTES_SUPER_ADMIN',
      [Permission.QUOTES_READ],
    );
    const token = await loginAndGetToken(adminEmail);
    const nonexistentId = '00000000-0000-4000-8000-000000000000';

    const response = await adminGraphqlRequest(token, QUOTE_DETAIL_QUERY, {
      id: nonexistentId,
    }).expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_QUOTE_NOT_FOUND');
  });

  it('an admin without QUOTES_READ -> ADMIN_FORBIDDEN', async () => {
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_QUOTES_NO_ACCESS',
      [Permission.AUDIT_LOG_READ],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, QUOTES_QUERY, {
      limit: 10,
      offset: 0,
    }).expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
  });

  it('quotes without an Authorization header -> ADMIN_UNAUTHENTICATED', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: QUOTES_QUERY, variables: { limit: 10, offset: 0 } })
      .expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
  });
});
