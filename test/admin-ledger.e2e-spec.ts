import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressOwnerRole,
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

const CANCEL_ENGAGEMENT_BY_PROFESSIONAL_MUTATION = `
  mutation CancelEngagementByProfessional($engagementId: ID!, $reason: String!) {
    cancelEngagementByProfessional(engagementId: $engagementId, reason: $reason) { id status }
  }
`;

const ADMIN_LEDGER_ENTRY_FIELDS = `
  id receiptNumber type amount currency engagementId customerProfileId professionalProfileId commissionPercentApplied createdAt
`;

const ADMIN_LEDGER_ENTRIES_QUERY = `
  query AdminLedgerEntries($filter: AdminLedgerEntriesFilterInput, $limit: Int, $offset: Int) {
    adminLedgerEntries(filter: $filter, limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items { ${ADMIN_LEDGER_ENTRY_FIELDS} }
    }
  }
`;

const ADMIN_ENGAGEMENT_PAYMENT_SUMMARY_FIELDS = `
  engagementId
  eventType
  paymentMethod
  totalPaidByCustomer
  platformCommission
  professionalNetAmount
  currency
  professionalTotalPendingCashDebt
  customer { id userId email firstName lastName }
  professional { id userId email firstName lastName displayName }
  entries { id receiptNumber type amount }
`;

const ADMIN_ENGAGEMENT_PAYMENT_SUMMARIES_QUERY = `
  query AdminEngagementPaymentSummaries($limit: Int, $offset: Int) {
    adminEngagementPaymentSummaries(limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items { ${ADMIN_ENGAGEMENT_PAYMENT_SUMMARY_FIELDS} }
    }
  }
`;

interface AdminEngagementPaymentSummaryPayload {
  engagementId: string;
  eventType: string;
  paymentMethod: string | null;
  totalPaidByCustomer: number;
  platformCommission: number;
  professionalNetAmount: number;
  currency: string;
  professionalTotalPendingCashDebt: number | null;
  customer: { id: string; firstName: string; lastName: string };
  professional: { id: string; firstName: string; lastName: string };
  entries: { id: string; type: string }[];
}

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface AdminLedgerEntryPayload {
  id: string;
  receiptNumber: number;
  type: string;
  amount: number;
  currency: string;
  engagementId: string | null;
  professionalProfileId: string | null;
  commissionPercentApplied: number | null;
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
 * e2e coverage for GOS-109's admin surface — `adminLedgerEntries`
 * (`src/platform-admin/ledger/`): `LEDGER_READ` enforcement, the
 * filter/pagination arguments, against ledger rows written by a real
 * `cancelEngagementByCustomer`/`cancelEngagementByProfessional` flow (not
 * hand-inserted rows).
 */
describe('GraphQL /admin/graphql — adminLedgerEntries (GOS-109, e2e)', () => {
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
    const email = uniqueEmail('admin-ledger');
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
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId,
        firstName: 'Cliente',
        lastName: 'de Prueba',
        country: CountryCode.AR,
      },
    });
    // GOS-155 — publishServiceRequest now requires a resolvable addressId;
    // this seeds the caller's own default Address so it can fall back to it.
    await prisma.address.create({
      data: {
        ownerRole: AddressOwnerRole.CUSTOMER,
        customerProfileId: customerProfile.id,
        formattedAddress: 'Av. Corrientes 1234, CABA',
        placeId: `place-${Date.now()}-${Math.random()}`,
        latitude: -34.6037,
        longitude: -58.3816,
        isDefault: true,
      },
    });
    return { email };
  }

  async function seedApprovedProfessional(
    categoryIds: string[],
  ): Promise<{ email: string; professionalProfileId: string }> {
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
    return { email, professionalProfileId: professionalProfile.id };
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

  /** Publish -> submit -> accept -> cancel(by customer, while ACCEPTED, so
   * no charge) — just to have an Engagement to reference; the professional
   * cancellation test below drives its own, separate Engagement instead so
   * the two flows never collide on the same row set. */
  async function seedRefundedEngagement(): Promise<{
    engagementId: string;
    professionalProfileId: string;
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

    await consumerRequest(
      CANCEL_ENGAGEMENT_BY_PROFESSIONAL_MUTATION,
      { engagementId, reason: 'no puedo cumplir' },
      professionalToken,
    ).expect(200);

    return {
      engagementId,
      professionalProfileId: professional.professionalProfileId,
    };
  }

  it('lists LedgerEntry rows written by a real cancellation flow, filtered by engagementId, gated by LEDGER_READ', async () => {
    const { engagementId, professionalProfileId } =
      await seedRefundedEngagement();
    const admin = await seedAdminWithRole('ledger-reader', [
      Permission.LEDGER_READ,
    ]);
    const token = await loginAdminAndGetToken(admin.email);

    const response = await adminGraphqlRequest(
      token,
      ADMIN_LEDGER_ENTRIES_QUERY,
      { filter: { engagementId } },
    ).expect(200);
    const body = response.body as {
      data: { adminLedgerEntries: { items: AdminLedgerEntryPayload[] } };
    };

    expect(body.data.adminLedgerEntries.items).toHaveLength(1);
    expect(body.data.adminLedgerEntries.items[0]).toMatchObject({
      type: 'REFUND',
      amount: 5000,
      currency: 'ARS',
      engagementId,
      commissionPercentApplied: null,
    });
    // 2026-09-14 follow-up — the human-facing "comprobante interno"
    // sequential number: a real, positive, unique integer, never 0/null.
    expect(body.data.adminLedgerEntries.items[0].receiptNumber).toBeGreaterThan(
      0,
    );

    // Also filterable by professionalProfileId (the REFUND entry has no
    // professionalProfileId, so this must return zero, proving the filter
    // actually narrows rather than ignoring the argument).
    const byProfessional = await adminGraphqlRequest(
      token,
      ADMIN_LEDGER_ENTRIES_QUERY,
      { filter: { professionalProfileId } },
    ).expect(200);
    const byProfessionalBody = byProfessional.body as {
      data: { adminLedgerEntries: { items: AdminLedgerEntryPayload[] } };
    };
    expect(
      byProfessionalBody.data.adminLedgerEntries.items.some(
        (i) => i.engagementId === engagementId,
      ),
    ).toBe(false);
  });

  it('respects limit/offset pagination', async () => {
    await seedRefundedEngagement();
    await seedRefundedEngagement();
    const admin = await seedAdminWithRole('ledger-reader-page', [
      Permission.LEDGER_READ,
    ]);
    const token = await loginAdminAndGetToken(admin.email);

    const response = await adminGraphqlRequest(
      token,
      ADMIN_LEDGER_ENTRIES_QUERY,
      { limit: 1, offset: 0 },
    ).expect(200);
    const body = response.body as {
      data: {
        adminLedgerEntries: {
          items: AdminLedgerEntryPayload[];
          limit: number;
          offset: number;
          totalCount: number;
        };
      };
    };

    expect(body.data.adminLedgerEntries.items).toHaveLength(1);
    expect(body.data.adminLedgerEntries.limit).toBe(1);
    expect(body.data.adminLedgerEntries.offset).toBe(0);
    expect(body.data.adminLedgerEntries.totalCount).toBeGreaterThanOrEqual(2);
  });

  it('rejects an admin without LEDGER_READ with ADMIN_FORBIDDEN', async () => {
    const admin = await seedAdminWithRole('ledger-none', []);
    const token = await loginAdminAndGetToken(admin.email);

    const response = await adminGraphqlRequest(
      token,
      ADMIN_LEDGER_ENTRIES_QUERY,
      {},
    ).expect(200);

    expect(errorCode(response.body)).toBe('ADMIN_FORBIDDEN');
  });

  /**
   * e2e coverage for `adminEngagementPaymentSummaries` (2026-09-14
   * follow-up, human-requested) — ONE ROW PER JOB, with real names and
   * pre-computed totals, against a row written by a real
   * `cancelEngagementByProfessional` flow (not a hand-inserted row).
   */
  describe('adminEngagementPaymentSummaries', () => {
    it('summarizes a real PROFESSIONAL_CANCELLATION (REFUND) event with real Customer/Professional names', async () => {
      const { engagementId } = await seedRefundedEngagement();
      const admin = await seedAdminWithRole('payment-summary-reader', [
        Permission.LEDGER_READ,
      ]);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(
        token,
        ADMIN_ENGAGEMENT_PAYMENT_SUMMARIES_QUERY,
        { limit: 200, offset: 0 },
      ).expect(200);
      const body = response.body as {
        data: {
          adminEngagementPaymentSummaries: {
            items: AdminEngagementPaymentSummaryPayload[];
          };
        };
      };

      const summary = body.data.adminEngagementPaymentSummaries.items.find(
        (item) => item.engagementId === engagementId,
      );
      expect(summary).toBeDefined();
      expect(summary).toMatchObject({
        eventType: 'PROFESSIONAL_CANCELLATION',
        totalPaidByCustomer: 0,
        platformCommission: 0,
        professionalNetAmount: 0,
        currency: 'ARS',
        professionalTotalPendingCashDebt: null,
      });
      expect(summary?.customer.firstName).toBe('Cliente');
      expect(summary?.professional.firstName).toBe('Profesional');
      expect(summary?.entries).toHaveLength(1);
      expect(summary?.entries[0].type).toBe('REFUND');
    });

    it('GOS-146: serializes a job whose Engagement.paymentMethod is RAPYD (the new PaymentMethod value) without breaking the admin query', async () => {
      // A serialization check of the shared `PaymentMethod` enum, not of the
      // Rapyd payment flow (covered by `rapyd-payment.e2e-spec.ts`): the value is
      // set directly on an Engagement that already has a ledger event.
      const { engagementId } = await seedRefundedEngagement();
      await prisma.engagement.update({
        where: { id: engagementId },
        data: { paymentMethod: 'RAPYD' },
      });
      const admin = await seedAdminWithRole('payment-summary-rapyd', [
        Permission.LEDGER_READ,
      ]);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(
        token,
        ADMIN_ENGAGEMENT_PAYMENT_SUMMARIES_QUERY,
        { limit: 200, offset: 0 },
      ).expect(200);
      const body = response.body as {
        errors?: unknown;
        data: {
          adminEngagementPaymentSummaries: {
            items: AdminEngagementPaymentSummaryPayload[];
          };
        };
      };

      expect(body.errors).toBeUndefined();
      expect(
        body.data.adminEngagementPaymentSummaries.items.find(
          (item) => item.engagementId === engagementId,
        )?.paymentMethod,
      ).toBe('RAPYD');
    });

    it('rejects an admin without LEDGER_READ with ADMIN_FORBIDDEN', async () => {
      const admin = await seedAdminWithRole('payment-summary-none', []);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(
        token,
        ADMIN_ENGAGEMENT_PAYMENT_SUMMARIES_QUERY,
        {},
      ).expect(200);

      expect(errorCode(response.body)).toBe('ADMIN_FORBIDDEN');
    });
  });
});
