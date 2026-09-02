import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminUserStatus,
  AuthProvider,
  CountryCode,
  Permission,
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
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
  }
`;

const SERVICE_REQUESTS_QUERY = `
  query ServiceRequests($limit: Int, $offset: Int) {
    serviceRequests(limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        description
        urgency
        status
        attachmentsCount
        category { id name }
        customer { id userId email firstName lastName }
      }
    }
  }
`;

const ADMIN_CATEGORIES_QUERY = `
  query AdminCategories {
    serviceRequestCategories { id name }
  }
`;

const ELIGIBLE_CUSTOMERS_QUERY = `
  query EligibleServiceRequestCustomers($search: String) {
    eligibleServiceRequestCustomers(search: $search) {
      id
      userId
      firstName
      lastName
      email
    }
  }
`;

const CREATE_SERVICE_REQUEST_MUTATION = `
  mutation CreateServiceRequestForCustomer($input: AdminCreateServiceRequestInput!) {
    createServiceRequestForCustomer(input: $input) {
      id
      status
      customer { userId email }
      category { id }
    }
  }
`;

const SERVICE_REQUEST_DETAIL_QUERY = `
  query ServiceRequestDetail($id: ID!) {
    serviceRequestDetail(id: $id) {
      id
      description
      urgency
      status
      indicativeBudgetMin
      indicativeBudgetMax
      category { id name }
      customer { id userId email firstName lastName }
      attachments { id url createdAt }
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
 * e2e coverage for `serviceRequests`/`serviceRequestDetail` (GOS-38
 * follow-up, admin panel's Service Requests grid) — SERVICE_REQUESTS_READ
 * permission enforcement, the customer/user relation surfaced on every row,
 * and the detail view's full attachment list.
 */
describe('GraphQL /admin/graphql — serviceRequests/serviceRequestDetail (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  // `adminLogin` is tightly throttled (5/60s — see
  // `admin-auth.resolver.ts`'s own rate-limit note) and this file logs in
  // an admin per test — same "flush the Redis-backed throttle counter
  // before every test" convention `admin-user-accounts.e2e-spec.ts`
  // already establishes, without which this file alone (and whichever
  // other admin-heavy spec happens to run around it) would blow the
  // shared budget.
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

  async function seedCustomerWithServiceRequest(categoryId: string): Promise<{
    userId: string;
    customerProfileId: string;
    userEmail: string;
    serviceRequestId: string;
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
        firstName: 'Juan',
        lastName: 'Perez',
        addressLine: 'Calle Falsa 123',
        city: 'CABA',
        province: 'Buenos Aires',
        country: CountryCode.AR,
      },
    });
    const serviceRequest = await prisma.serviceRequest.create({
      data: {
        customerProfileId: customerProfile.id,
        categoryId,
        description: 'Se rompió una cañería en la cocina.',
        urgency: ServiceRequestUrgency.URGENT,
        attachments: {
          create: [{ url: 'http://localhost:3000/uploads/fake.jpg', order: 0 }],
        },
      },
    });
    return {
      userId: user.id,
      customerProfileId: customerProfile.id,
      userEmail,
      serviceRequestId: serviceRequest.id,
    };
  }

  /** Seeds a `User` at the given `accountStatus`, with a `CustomerProfile`
   * only when `withCustomerProfile` is true — used by the
   * `createServiceRequestForCustomer` tests to exercise every rejection
   * path (not APPROVED, APPROVED-but-no-CustomerProfile). */
  async function seedCustomer(options: {
    accountStatus: UserAccountStatus;
    withCustomerProfile: boolean;
  }): Promise<{ userId: string; userEmail: string }> {
    const userEmail = uniqueEmail('consumer');
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        firstName: 'Ana',
        lastName: 'Gomez',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: options.accountStatus,
      },
    });
    if (options.withCustomerProfile) {
      await prisma.customerProfile.create({
        data: {
          userId: user.id,
          firstName: 'Ana',
          lastName: 'Gomez',
          addressLine: 'Calle Falsa 456',
          city: 'CABA',
          province: 'Buenos Aires',
          country: CountryCode.AR,
        },
      });
    }
    return { userId: user.id, userEmail };
  }

  it('SUPER_ADMIN (SERVICE_REQUESTS_READ) lists ServiceRequests including the owning customer/user', async () => {
    const categoryId = await seedCategory();
    const { userEmail, serviceRequestId } =
      await seedCustomerWithServiceRequest(categoryId);
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_SR_SUPER_ADMIN',
      [Permission.SERVICE_REQUESTS_READ],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, SERVICE_REQUESTS_QUERY, {
      limit: 200,
      offset: 0,
    }).expect(200);
    const body = response.body as {
      data: {
        serviceRequests: {
          totalCount: number;
          items: {
            id: string;
            attachmentsCount: number;
            customer: { email: string };
          }[];
        };
      };
      errors?: unknown[];
    };

    expect(body.errors).toBeUndefined();
    const row = body.data.serviceRequests.items.find(
      (item) => item.id === serviceRequestId,
    );
    expect(row).toBeDefined();
    expect(row?.attachmentsCount).toBe(1);
    expect(row?.customer.email).toBe(userEmail);
  });

  it('serviceRequestDetail returns the full detail, including attachments and the owning customer', async () => {
    const categoryId = await seedCategory();
    const { userEmail, serviceRequestId } =
      await seedCustomerWithServiceRequest(categoryId);
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_SR_SUPER_ADMIN',
      [Permission.SERVICE_REQUESTS_READ],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(
      token,
      SERVICE_REQUEST_DETAIL_QUERY,
      { id: serviceRequestId },
    ).expect(200);
    const body = response.body as {
      data: {
        serviceRequestDetail: {
          id: string;
          customer: { email: string };
          attachments: { id: string; url: string }[];
        };
      };
      errors?: unknown[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.serviceRequestDetail.customer.email).toBe(userEmail);
    expect(body.data.serviceRequestDetail.attachments).toHaveLength(1);
  });

  it('serviceRequestDetail for a nonexistent id -> ADMIN_SERVICE_REQUEST_NOT_FOUND', async () => {
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_SR_SUPER_ADMIN',
      [Permission.SERVICE_REQUESTS_READ],
    );
    const token = await loginAndGetToken(adminEmail);
    const nonexistentId = '00000000-0000-4000-8000-000000000000';

    const response = await adminGraphqlRequest(
      token,
      SERVICE_REQUEST_DETAIL_QUERY,
      { id: nonexistentId },
    ).expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe(
      'ADMIN_SERVICE_REQUEST_NOT_FOUND',
    );
  });

  it('an admin without SERVICE_REQUESTS_READ -> ADMIN_FORBIDDEN', async () => {
    const { email: adminEmail } = await seedAdminWithRole('E2E_SR_NO_ACCESS', [
      Permission.AUDIT_LOG_READ,
    ]);
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, SERVICE_REQUESTS_QUERY, {
      limit: 10,
      offset: 0,
    }).expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
  });

  it('serviceRequests without an Authorization header -> ADMIN_UNAUTHENTICATED', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({
        query: SERVICE_REQUESTS_QUERY,
        variables: { limit: 10, offset: 0 },
      })
      .expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
  });

  // ---------------------------------------------------------------------
  // createServiceRequestForCustomer / eligibleServiceRequestCustomers /
  // categories (GOS-38 follow-up, 2026-08-18) — "create a ServiceRequest on
  // behalf of an already-APPROVED customer".
  // ---------------------------------------------------------------------

  it('eligibleServiceRequestCustomers only lists APPROVED customers, never a PENDING_APPROVAL one', async () => {
    const approved = await seedCustomer({
      accountStatus: UserAccountStatus.APPROVED,
      withCustomerProfile: true,
    });
    const pending = await seedCustomer({
      accountStatus: UserAccountStatus.PENDING_APPROVAL,
      withCustomerProfile: true,
    });
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_SR_WRITE_ADMIN',
      [Permission.SERVICE_REQUESTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(
      token,
      ELIGIBLE_CUSTOMERS_QUERY,
      { search: null },
    ).expect(200);
    const body = response.body as {
      data: { eligibleServiceRequestCustomers: { userId: string }[] };
      errors?: unknown[];
    };

    expect(body.errors).toBeUndefined();
    const returnedUserIds = body.data.eligibleServiceRequestCustomers.map(
      (c) => c.userId,
    );
    expect(returnedUserIds).toContain(approved.userId);
    expect(returnedUserIds).not.toContain(pending.userId);
  });

  it('an admin with SERVICE_REQUESTS_WRITE can create a ServiceRequest for an APPROVED customer', async () => {
    const categoryId = await seedCategory();
    const customer = await seedCustomer({
      accountStatus: UserAccountStatus.APPROVED,
      withCustomerProfile: true,
    });
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_SR_WRITE_ADMIN',
      [Permission.SERVICE_REQUESTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const categoriesResponse = await adminGraphqlRequest(
      token,
      ADMIN_CATEGORIES_QUERY,
    ).expect(200);
    const categoriesBody = categoriesResponse.body as {
      data: { serviceRequestCategories: { id: string }[] };
    };
    expect(
      categoriesBody.data.serviceRequestCategories.some(
        (c) => c.id === categoryId,
      ),
    ).toBe(true);

    const response = await adminGraphqlRequest(
      token,
      CREATE_SERVICE_REQUEST_MUTATION,
      {
        input: {
          userId: customer.userId,
          category: categoryId,
          description: 'Necesito un electricista con urgencia.',
          urgency: 'URGENT',
        },
      },
    ).expect(200);
    const body = response.body as {
      data: {
        createServiceRequestForCustomer: {
          id: string;
          status: string;
          customer: { userId: string };
        };
      };
      errors?: unknown[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.createServiceRequestForCustomer.status).toBe('OPEN');
    expect(body.data.createServiceRequestForCustomer.customer.userId).toBe(
      customer.userId,
    );

    const persisted = await prisma.serviceRequest.findUnique({
      where: { id: body.data.createServiceRequestForCustomer.id },
    });
    expect(persisted).not.toBeNull();

    const auditRow = await prisma.adminAuditLog.findFirst({
      where: {
        targetType: 'ServiceRequest',
        targetKey: body.data.createServiceRequestForCustomer.id,
      },
    });
    expect(auditRow?.action).toBe('SERVICE_REQUEST_CREATED_BY_ADMIN');
  });

  it('createServiceRequestForCustomer for a PENDING_APPROVAL customer -> ACCOUNT_NOT_APPROVED', async () => {
    const categoryId = await seedCategory();
    const customer = await seedCustomer({
      accountStatus: UserAccountStatus.PENDING_APPROVAL,
      withCustomerProfile: true,
    });
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_SR_WRITE_ADMIN',
      [Permission.SERVICE_REQUESTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(
      token,
      CREATE_SERVICE_REQUEST_MUTATION,
      {
        input: {
          userId: customer.userId,
          category: categoryId,
          description: 'No debería poder crearse.',
          urgency: 'URGENT',
        },
      },
    ).expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe('ACCOUNT_NOT_APPROVED');
  });

  it('createServiceRequestForCustomer for an APPROVED user with no CustomerProfile -> CUSTOMER_PROFILE_REQUIRED', async () => {
    const categoryId = await seedCategory();
    const customer = await seedCustomer({
      accountStatus: UserAccountStatus.APPROVED,
      withCustomerProfile: false,
    });
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_SR_WRITE_ADMIN',
      [Permission.SERVICE_REQUESTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(
      token,
      CREATE_SERVICE_REQUEST_MUTATION,
      {
        input: {
          userId: customer.userId,
          category: categoryId,
          description: 'No debería poder crearse.',
          urgency: 'URGENT',
        },
      },
    ).expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe(
      'CUSTOMER_PROFILE_REQUIRED',
    );
  });

  it('an admin with only SERVICE_REQUESTS_READ cannot createServiceRequestForCustomer -> ADMIN_FORBIDDEN', async () => {
    const categoryId = await seedCategory();
    const customer = await seedCustomer({
      accountStatus: UserAccountStatus.APPROVED,
      withCustomerProfile: true,
    });
    const { email: adminEmail } = await seedAdminWithRole(
      'E2E_SR_READ_ONLY_ADMIN',
      [Permission.SERVICE_REQUESTS_READ],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(
      token,
      CREATE_SERVICE_REQUEST_MUTATION,
      {
        input: {
          userId: customer.userId,
          category: categoryId,
          description: 'No debería poder crearse.',
          urgency: 'URGENT',
        },
      },
    ).expect(200);
    const body = response.body as {
      errors?: { extensions?: { code?: string } }[];
    };

    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
  });
});
