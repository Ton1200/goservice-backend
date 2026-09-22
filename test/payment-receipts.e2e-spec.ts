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
  cleanLedgerData,
  cleanProfilesData,
  cleanQuotesAndEngagementsData,
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

const PASSWORD = 'super-secret-1';

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

const MY_PAYMENT_RECEIPTS_QUERY = `
  query {
    myPaymentReceipts {
      id
      receiptNumber
      type
      amount
      currency
      engagementId
      commissionPercentApplied
      createdAt
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface PaymentReceiptPayload {
  id: string;
  receiptNumber: number;
  type: string;
  amount: number;
  currency: string;
  engagementId: string | null;
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
 * e2e coverage for `myPaymentReceipts` (2026-09-14 follow-up,
 * human-requested) — a consumer-facing "comprobante interno" view over the
 * same `LedgerEntry` table `adminLedgerEntries` already audits. Against
 * rows written by a real `cancelEngagementByProfessional` flow (not
 * hand-inserted rows).
 */
describe('GraphQL myPaymentReceipts (2026-09-14, e2e)', () => {
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
    const email = uniqueEmail('payment-receipts');
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

  /** Publish -> submit -> accept -> cancel(by professional) — a real REFUND
   * LedgerEntry naming both parties. */
  async function seedRefundedEngagement(): Promise<{
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
          price: 5000,
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

    await gqlRequest(
      CANCEL_ENGAGEMENT_BY_PROFESSIONAL_MUTATION,
      { engagementId, reason: 'no puedo cumplir' },
      professionalToken,
    ).expect(200);

    return { engagementId, customerToken, professionalToken };
  }

  it('the Customer sees their own REFUND receipt, with a real positive receiptNumber', async () => {
    const { engagementId, customerToken } = await seedRefundedEngagement();

    const response = await gqlRequest(
      MY_PAYMENT_RECEIPTS_QUERY,
      {},
      customerToken,
    ).expect(200);
    const body = response.body as {
      data: { myPaymentReceipts: PaymentReceiptPayload[] };
    };

    const receipt = body.data.myPaymentReceipts.find(
      (r) => r.engagementId === engagementId,
    );
    expect(receipt).toMatchObject({
      type: 'REFUND',
      amount: 5000,
      currency: 'ARS',
      commissionPercentApplied: null,
    });
    expect(receipt?.receiptNumber).toBeGreaterThan(0);
  });

  it('an unrelated third party sees an empty list, never the other party’s receipt', async () => {
    await seedRefundedEngagement();
    const outsider = await seedApprovedCustomer();
    const outsiderToken = await loginSessionToken(outsider.email);

    const response = await gqlRequest(
      MY_PAYMENT_RECEIPTS_QUERY,
      {},
      outsiderToken,
    ).expect(200);
    const body = response.body as {
      data: { myPaymentReceipts: PaymentReceiptPayload[] };
    };

    expect(body.data.myPaymentReceipts).toEqual([]);
  });

  it('rejects with UNAUTHENTICATED when no session token is provided', async () => {
    const response = await gqlRequest(MY_PAYMENT_RECEIPTS_QUERY, {}).expect(
      200,
    );

    expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
  });
});
