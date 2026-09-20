import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminUserStatus,
  AuthProvider,
  CountryCode,
  Permission,
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
  cleanAdminUsersData,
  cleanAppointmentsData,
  cleanCashPaymentData,
  cleanLedgerData,
  cleanProfilesData,
  cleanQuotesAndEngagementsData,
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

const PASSWORD = 'super-secret-1';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
  }
`;

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const PUBLISH_SERVICE_REQUEST_MUTATION = `
  mutation PublishServiceRequest($input: PublishServiceRequestInput!) {
    publishServiceRequest(input: $input) { id status }
  }
`;

const SUBMIT_QUOTE_MUTATION = `
  mutation SubmitQuote($input: SubmitQuoteInput!) {
    submitQuote(input: $input) { id status }
  }
`;

const ACCEPT_QUOTE_MUTATION = `
  mutation AcceptQuote($quoteId: ID!) {
    acceptQuote(quoteId: $quoteId) { engagement { id status } }
  }
`;

const PROPOSE_APPOINTMENT_MUTATION = `
  mutation ProposeAppointment($engagementId: ID!, $input: ProposeAppointmentInput!) {
    proposeAppointment(engagementId: $engagementId, input: $input) { id status }
  }
`;

const ACCEPT_APPOINTMENT_MUTATION = `
  mutation AcceptAppointment($id: ID!) {
    acceptAppointment(id: $id) { id status }
  }
`;

const START_ENGAGEMENT_WORK_MUTATION = `
  mutation StartEngagementWork($engagementId: ID!) {
    startEngagementWork(engagementId: $engagementId) { id status }
  }
`;

const CONFIRM_CASH_PAYMENT_MUTATION = `
  mutation ConfirmCashPayment($engagementId: ID!) {
    confirmCashPayment(engagementId: $engagementId) { id }
  }
`;

const ADMIN_PAYMENT_ATTEMPT_FIELDS = `
  id engagementId method type status
  customerConfirmedAt professionalConfirmedAt createdAt
`;

const ADMIN_PAYMENT_ATTEMPTS_QUERY = `
  query AdminPaymentAttempts($filter: AdminPaymentAttemptsFilterInput, $limit: Int, $offset: Int) {
    adminPaymentAttempts(filter: $filter, limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items { ${ADMIN_PAYMENT_ATTEMPT_FIELDS} }
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface AdminPaymentAttemptPayload {
  id: string;
  engagementId: string;
  method: string;
  type: string | null;
  status: string;
  customerConfirmedAt: string | null;
  professionalConfirmedAt: string | null;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorCode(body: unknown): string | undefined {
  return (body as { errors?: GraphQLErrorEntry[] }).errors?.[0]?.extensions
    ?.code;
}

/**
 * e2e coverage for the admin surface `adminPaymentAttempts`
 * (`src/platform-admin/payment-attempts/`) — `CASH_PAYMENTS_READ`
 * enforcement and visibility into a half-confirmed cash case, against rows
 * written by a real `confirmCashPayment` flow (not hand-inserted rows).
 * Replaces the pre-generalization `admin-cash-payment.e2e-spec.ts`
 * (`adminCashPaymentConfirmations`, cash-only — 2026-09-18: cash lives in
 * `PaymentAttempt` together with every other method).
 */
describe('GraphQL /admin/graphql — adminPaymentAttempts (e2e)', () => {
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
  });

  afterAll(async () => {
    await cleanCashPaymentData(prisma);
    await cleanLedgerData(prisma);
    await cleanAppointmentsData(prisma);
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

  async function loginAdminAndGetToken(email: string): Promise<string> {
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

  async function seedUser(): Promise<{ email: string; userId: string }> {
    const email = uniqueEmail('admin-payment-attempts');
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Test',
        lastName: 'User',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.APPROVED,
      },
    });
    return { email, userId: user.id };
  }

  async function seedApprovedCustomer(): Promise<{ email: string }> {
    const { email, userId } = await seedUser();
    await prisma.customerProfile.create({
      data: {
        userId,
        firstName: 'Cliente',
        lastName: 'de Prueba',
        country: CountryCode.AR,
      },
    });
    return { email };
  }

  async function seedApprovedProfessional(
    categoryIds: string[],
  ): Promise<{ email: string }> {
    const { email, userId } = await seedUser();
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
    return { email };
  }

  async function seedCategory(): Promise<string> {
    const category = await prisma.category.create({
      data: { name: uniqueCategoryName('Categoria') },
    });
    createdCategoryIds.push(category.id);
    return category.id;
  }

  async function loginConsumerSessionToken(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    return (response.body as { data: { login: { sessionToken: string } } }).data
      .login.sessionToken;
  }

  function consumerRequest(
    query: string,
    variables: Record<string, unknown>,
    token: string,
  ) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables })
      .set('Authorization', `Bearer ${token}`);
  }

  /** Publish -> submit -> accept -> appointment -> startEngagementWork ->
   * ONLY the Customer confirms cash payment — a real, half-confirmed cash
   * PaymentAttempt row. */
  async function seedHalfConfirmedCashPayment(): Promise<{
    engagementId: string;
  }> {
    const categoryId = await seedCategory();
    const customer = await seedApprovedCustomer();
    const professional = await seedApprovedProfessional([categoryId]);
    const customerToken = await loginConsumerSessionToken(customer.email);
    const professionalToken = await loginConsumerSessionToken(
      professional.email,
    );

    const publishResponse = await consumerRequest(
      PUBLISH_SERVICE_REQUEST_MUTATION,
      {
        input: {
          category: categoryId,
          description: 'Se rompió una cañería en la cocina y pierde agua.',
          urgency: 'URGENT',
        },
      },
      customerToken,
    ).expect(200);
    const serviceRequestId = (
      publishResponse.body as {
        data: { publishServiceRequest: { id: string } };
      }
    ).data.publishServiceRequest.id;

    const submitResponse = await consumerRequest(
      SUBMIT_QUOTE_MUTATION,
      {
        input: {
          serviceRequestId,
          price: 5000,
          message: 'Puedo hacerlo mañana temprano.',
        },
      },
      professionalToken,
    ).expect(200);
    const quoteId = (
      submitResponse.body as { data: { submitQuote: { id: string } } }
    ).data.submitQuote.id;

    const acceptResponse = await consumerRequest(
      ACCEPT_QUOTE_MUTATION,
      { quoteId },
      customerToken,
    ).expect(200);
    const engagementId = (
      acceptResponse.body as {
        data: { acceptQuote: { engagement: { id: string } } };
      }
    ).data.acceptQuote.engagement.id;

    const proposeResponse = await consumerRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-09-15T10:00:00.000Z',
          endsAt: '2026-09-15T12:00:00.000Z',
        },
      },
      customerToken,
    ).expect(200);
    const appointmentId = (
      proposeResponse.body as { data: { proposeAppointment: { id: string } } }
    ).data.proposeAppointment.id;
    await consumerRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      professionalToken,
    ).expect(200);
    await consumerRequest(
      START_ENGAGEMENT_WORK_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);

    // Only the Customer confirms — deliberately half-confirmed.
    await consumerRequest(
      CONFIRM_CASH_PAYMENT_MUTATION,
      { engagementId },
      customerToken,
    ).expect(200);

    return { engagementId };
  }

  it('shows a half-confirmed cash PaymentAttempt (only one party confirmed, still PENDING), filterable by onlyPending, gated by CASH_PAYMENTS_READ', async () => {
    const { engagementId } = await seedHalfConfirmedCashPayment();
    const admin = await seedAdminWithRole('payment-attempts-reader', [
      Permission.CASH_PAYMENTS_READ,
    ]);
    const token = await loginAdminAndGetToken(admin.email);

    const response = await adminGraphqlRequest(
      token,
      ADMIN_PAYMENT_ATTEMPTS_QUERY,
      { filter: { engagementId } },
    ).expect(200);
    const body = response.body as {
      data: { adminPaymentAttempts: { items: AdminPaymentAttemptPayload[] } };
    };

    expect(body.data.adminPaymentAttempts.items).toHaveLength(1);
    expect(body.data.adminPaymentAttempts.items[0]).toMatchObject({
      engagementId,
      method: 'CASH',
      type: 'CASH',
      status: 'PENDING',
      professionalConfirmedAt: null,
    });
    expect(
      body.data.adminPaymentAttempts.items[0].customerConfirmedAt,
    ).not.toBeNull();

    // onlyPending: true must still include this half-confirmed (PENDING) row.
    const pendingOnly = await adminGraphqlRequest(
      token,
      ADMIN_PAYMENT_ATTEMPTS_QUERY,
      { filter: { onlyPending: true, engagementId } },
    ).expect(200);
    const pendingOnlyBody = pendingOnly.body as {
      data: { adminPaymentAttempts: { items: AdminPaymentAttemptPayload[] } };
    };
    expect(pendingOnlyBody.data.adminPaymentAttempts.items).toHaveLength(1);
  });

  it('rejects an admin without CASH_PAYMENTS_READ with ADMIN_FORBIDDEN', async () => {
    const admin = await seedAdminWithRole('payment-attempts-none', []);
    const token = await loginAdminAndGetToken(admin.email);

    const response = await adminGraphqlRequest(
      token,
      ADMIN_PAYMENT_ATTEMPTS_QUERY,
      {},
    ).expect(200);

    expect(errorCode(response.body)).toBe('ADMIN_FORBIDDEN');
  });
});
