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
const COMMISSION_PERCENT_KEY = 'payments.general-settings.commission.percent';

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

const CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION = `
  mutation CancelEngagementByCustomer($engagementId: ID!, $reason: String!) {
    cancelEngagementByCustomer(engagementId: $engagementId, reason: $reason) { id status }
  }
`;

const CANCEL_ENGAGEMENT_BY_PROFESSIONAL_MUTATION = `
  mutation CancelEngagementByProfessional($engagementId: ID!, $reason: String!) {
    cancelEngagementByProfessional(engagementId: $engagementId, reason: $reason) { id status }
  }
`;

const CONFIRM_CASH_PAYMENT_MUTATION = `
  mutation ConfirmCashPayment($engagementId: ID!) {
    confirmCashPayment(engagementId: $engagementId) { id }
  }
`;

const ENGAGEMENT_FINANCIAL_SUMMARY_FIELDS = `
  engagementId
  currency
  eventType
  paymentMethod
  occurredAt
  viewerRole
  customer { workAmount platformFee cancellationFee refundAmount totalCharged }
  professional { grossAmount platformCommission netAmount cashCommissionDebt walletImpact }
`;

const ENGAGEMENT_FINANCIAL_SUMMARY_QUERY = `
  query EngagementFinancialSummary($engagementId: ID!) {
    engagementFinancialSummary(engagementId: $engagementId) {
      ${ENGAGEMENT_FINANCIAL_SUMMARY_FIELDS}
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface EngagementFinancialSummaryPayload {
  engagementId: string;
  currency: string;
  eventType: string | null;
  paymentMethod: string | null;
  occurredAt: string | null;
  viewerRole: string;
  customer: {
    workAmount: number;
    platformFee: number;
    cancellationFee: number;
    refundAmount: number;
    totalCharged: number;
  } | null;
  professional: {
    grossAmount: number;
    platformCommission: number;
    netAmount: number;
    cashCommissionDebt: number;
    walletImpact: number;
  } | null;
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
 * e2e coverage for `engagementFinancialSummary` (GOS-130 follow-up) — a
 * consumer-facing, per-Engagement, role-restricted financial view. Runs
 * against the isolated `postgres_test` database (port 5433), never the
 * shared dev Postgres. The `redis` container must be up (@nestjs/throttler).
 * Every case seeds through the REAL mutation flow (publish -> quote ->
 * accept -> propose/accept appointment -> startEngagementWork ->
 * confirmCashPayment/cancelEngagementByCustomer/cancelEngagementByProfessional),
 * never a hand-inserted `LedgerEntry` row.
 */
describe('GraphQL engagementFinancialSummary (GOS-130 follow-up, e2e)', () => {
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
    // Defensive — restore the seeded default commission percentage before
    // every test, same reasoning as the GOS-109/GOS-87 e2e suites' own
    // `beforeEach`.
    await prisma.platformSetting.upsert({
      where: { key: COMMISSION_PERCENT_KEY },
      update: { value: '10' },
      create: {
        key: COMMISSION_PERCENT_KEY,
        description: "GoService's global commission percentage.",
        valueType: 'NUMBER',
        value: '10',
        isPublic: false,
      },
    });
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
    await flushRedis();
    await app.close();
  });

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

  async function seedUser(): Promise<{ email: string; userId: string }> {
    const email = uniqueEmail('engagement-financial-summary');
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

  async function loginSessionToken(email: string): Promise<string> {
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

  /** Publish -> submit (price: 5000) -> accept — a real Engagement, still
   * ACCEPTED (pre-event). */
  async function seedAcceptedEngagement(price = 5000): Promise<{
    engagementId: string;
    customerToken: string;
    professionalToken: string;
  }> {
    const categoryId = await seedCategory();
    const customer = await seedApprovedCustomer();
    const professional = await seedApprovedProfessional([categoryId]);
    const customerToken = await loginSessionToken(customer.email);
    const professionalToken = await loginSessionToken(professional.email);

    const publishResponse = await gqlRequest(
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

    const submitResponse = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      {
        input: {
          serviceRequestId,
          price,
          message: 'Puedo hacerlo mañana temprano.',
        },
      },
      professionalToken,
    ).expect(200);
    const quoteId = (
      submitResponse.body as { data: { submitQuote: { id: string } } }
    ).data.submitQuote.id;

    const acceptResponse = await gqlRequest(
      ACCEPT_QUOTE_MUTATION,
      { quoteId },
      customerToken,
    ).expect(200);
    const engagementId = (
      acceptResponse.body as {
        data: { acceptQuote: { engagement: { id: string } } };
      }
    ).data.acceptQuote.engagement.id;

    return { engagementId, customerToken, professionalToken };
  }

  /** Propose (Customer) -> accept (Professional) -> startEngagementWork, so
   * the Engagement reaches IN_PROGRESS. Distinct slots per call — the same
   * Professional can only hold ONE CONFIRMED Appointment per time slot. */
  async function driveToInProgress(
    engagementId: string,
    customerToken: string,
    professionalToken: string,
    slot: { startsAt: string; endsAt: string } = {
      startsAt: '2026-09-16T10:00:00.000Z',
      endsAt: '2026-09-16T12:00:00.000Z',
    },
  ): Promise<void> {
    const proposeResponse = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      { engagementId, input: slot },
      customerToken,
    ).expect(200);
    const appointmentId = (
      proposeResponse.body as { data: { proposeAppointment: { id: string } } }
    ).data.proposeAppointment.id;

    await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      professionalToken,
    ).expect(200);

    await gqlRequest(
      START_ENGAGEMENT_WORK_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);
  }

  async function queryFinancialSummary(
    engagementId: string,
    token: string,
  ): Promise<{
    body: {
      data: {
        engagementFinancialSummary: EngagementFinancialSummaryPayload;
      } | null;
      errors?: GraphQLErrorEntry[];
    };
  }> {
    const response = await gqlRequest(
      ENGAGEMENT_FINANCIAL_SUMMARY_QUERY,
      { engagementId },
      token,
    ).expect(200);
    return { body: response.body as never };
  }

  it('pre-event (still ACCEPTED): both parties see their own workAmount/grossAmount = quotedPrice, null eventType/occurredAt', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedAcceptedEngagement(5000);

    const customerResult = await queryFinancialSummary(
      engagementId,
      customerToken,
    );
    expect(customerResult.body.errors).toBeUndefined();
    const customerSummary =
      customerResult.body.data!.engagementFinancialSummary;
    expect(customerSummary).toMatchObject({
      eventType: null,
      occurredAt: null,
      paymentMethod: null,
      currency: 'ARS',
      viewerRole: 'CUSTOMER',
      professional: null,
    });
    expect(customerSummary.customer).toMatchObject({
      workAmount: 5000,
      platformFee: 0,
      cancellationFee: 0,
      refundAmount: 0,
      totalCharged: 0,
    });

    const professionalResult = await queryFinancialSummary(
      engagementId,
      professionalToken,
    );
    const professionalSummary =
      professionalResult.body.data!.engagementFinancialSummary;
    expect(professionalSummary.viewerRole).toBe('PROFESSIONAL');
    expect(professionalSummary.customer).toBeNull();
    expect(professionalSummary.professional).toMatchObject({
      grossAmount: 5000,
      platformCommission: 0,
      netAmount: 0,
      cashCommissionDebt: 0,
      walletImpact: 0,
    });
  });

  it('CASH_PAYMENT: each party sees only their own side; the Professional’s walletImpact equals netAmount', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedAcceptedEngagement(5000);
    await driveToInProgress(engagementId, customerToken, professionalToken);

    await gqlRequest(
      CONFIRM_CASH_PAYMENT_MUTATION,
      { engagementId },
      customerToken,
    ).expect(200);
    await gqlRequest(
      CONFIRM_CASH_PAYMENT_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);

    const customerResult = await queryFinancialSummary(
      engagementId,
      customerToken,
    );
    const customerSummary =
      customerResult.body.data!.engagementFinancialSummary;
    expect(customerSummary).toMatchObject({
      eventType: 'CASH_PAYMENT',
      paymentMethod: 'CASH',
      viewerRole: 'CUSTOMER',
      professional: null,
    });
    expect(customerSummary.occurredAt).not.toBeNull();
    expect(customerSummary.customer).toMatchObject({
      workAmount: 5000,
      platformFee: 0,
      cancellationFee: 0,
      refundAmount: 0,
      totalCharged: 5000,
    });

    const professionalResult = await queryFinancialSummary(
      engagementId,
      professionalToken,
    );
    const professionalSummary =
      professionalResult.body.data!.engagementFinancialSummary;
    expect(professionalSummary.customer).toBeNull();
    expect(professionalSummary.professional).toMatchObject({
      grossAmount: 5000,
      platformCommission: 500,
      netAmount: 4500,
      cashCommissionDebt: 500,
      walletImpact: 4500,
    });
  });

  it('CUSTOMER_CANCELLATION (while IN_PROGRESS): each party sees only their own side, fee/commission/net split 10%', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedAcceptedEngagement(5000);
    await driveToInProgress(engagementId, customerToken, professionalToken);

    await gqlRequest(
      CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
      { engagementId, reason: 'cliente cancela en curso' },
      customerToken,
    ).expect(200);

    const customerResult = await queryFinancialSummary(
      engagementId,
      customerToken,
    );
    const customerSummary =
      customerResult.body.data!.engagementFinancialSummary;
    expect(customerSummary).toMatchObject({
      eventType: 'CUSTOMER_CANCELLATION',
      viewerRole: 'CUSTOMER',
      professional: null,
    });
    expect(customerSummary.customer).toMatchObject({
      workAmount: 5000,
      platformFee: 50,
      cancellationFee: 500,
      refundAmount: 0,
      totalCharged: 500,
    });

    const professionalResult = await queryFinancialSummary(
      engagementId,
      professionalToken,
    );
    const professionalSummary =
      professionalResult.body.data!.engagementFinancialSummary;
    expect(professionalSummary.customer).toBeNull();
    expect(professionalSummary.professional).toMatchObject({
      grossAmount: 500,
      platformCommission: 50,
      netAmount: 450,
      cashCommissionDebt: 0,
      walletImpact: 450,
    });
  });

  it('PROFESSIONAL_CANCELLATION: the Customer sees the real refundAmount; the Professional sees zero everywhere, walletImpact never negative', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedAcceptedEngagement(5000);

    await gqlRequest(
      CANCEL_ENGAGEMENT_BY_PROFESSIONAL_MUTATION,
      { engagementId, reason: 'no puedo cumplir' },
      professionalToken,
    ).expect(200);

    const customerResult = await queryFinancialSummary(
      engagementId,
      customerToken,
    );
    const customerSummary =
      customerResult.body.data!.engagementFinancialSummary;
    expect(customerSummary).toMatchObject({
      eventType: 'PROFESSIONAL_CANCELLATION',
      viewerRole: 'CUSTOMER',
      professional: null,
    });
    expect(customerSummary.customer).toMatchObject({
      workAmount: 5000,
      platformFee: 0,
      cancellationFee: 0,
      refundAmount: 5000,
      totalCharged: 0,
    });

    const professionalResult = await queryFinancialSummary(
      engagementId,
      professionalToken,
    );
    const professionalSummary =
      professionalResult.body.data!.engagementFinancialSummary;
    expect(professionalSummary.customer).toBeNull();
    expect(professionalSummary.professional).toMatchObject({
      grossAmount: 0,
      platformCommission: 0,
      netAmount: 0,
      cashCommissionDebt: 0,
      walletImpact: 0,
    });
  });

  it('rejects an unrelated third party with ENGAGEMENT_NOT_FOUND (anti-enumeration)', async () => {
    const { engagementId } = await seedAcceptedEngagement();
    const outsiderCategoryId = await seedCategory();
    const outsider = await seedApprovedProfessional([outsiderCategoryId]);
    const outsiderToken = await loginSessionToken(outsider.email);

    const response = await gqlRequest(
      ENGAGEMENT_FINANCIAL_SUMMARY_QUERY,
      { engagementId },
      outsiderToken,
    ).expect(200);

    expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
  });

  it('rejects with UNAUTHENTICATED when no session token is provided', async () => {
    const { engagementId } = await seedAcceptedEngagement();

    const response = await gqlRequest(ENGAGEMENT_FINANCIAL_SUMMARY_QUERY, {
      engagementId,
    }).expect(200);

    expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
  });
});
