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
import { CASH_PAYMENT_ENABLED_KEY } from '../src/cash-payment/guards/cash-payment-module-enabled.guard';
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

const CASH_CONFIRMATION_FIELDS = `
  id engagementId customerConfirmedAt professionalConfirmedAt commissionDebtRecorded createdAt
`;

const CONFIRM_CASH_PAYMENT_MUTATION = `
  mutation ConfirmCashPayment($engagementId: ID!) {
    confirmCashPayment(engagementId: $engagementId) { ${CASH_CONFIRMATION_FIELDS} }
  }
`;

const MY_PENDING_CASH_COMMISSION_DEBT_QUERY = `
  query {
    myPendingCashCommissionDebt
  }
`;

const MY_CASH_PAYMENT_CONFIRMATION_QUERY = `
  query MyCashPaymentConfirmation($engagementId: ID!) {
    myCashPaymentConfirmation(engagementId: $engagementId) {
      engagementId viewerRole customerConfirmed professionalConfirmed bothConfirmed
    }
  }
`;

interface CashPaymentConfirmationStatePayload {
  engagementId: string;
  viewerRole: 'CUSTOMER' | 'PROFESSIONAL';
  customerConfirmed: boolean;
  professionalConfirmed: boolean;
  bothConfirmed: boolean;
}

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface CashPaymentConfirmationPayload {
  id: string;
  engagementId: string;
  customerConfirmedAt: string | null;
  professionalConfirmedAt: string | null;
  commissionDebtRecorded: boolean;
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
 * e2e coverage for GOS-87 (Pago en Efectivo) — `confirmCashPayment`/
 * `myPendingCashCommissionDebt` (`src/cash-payment/`). Runs against the
 * isolated `postgres_test` database (port 5433), never the shared dev
 * Postgres. The `redis` container must be up (@nestjs/throttler).
 */
describe('GraphQL Cash Payment (GOS-87, e2e)', () => {
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
    // every test, in case another e2e spec file (e.g. the last test in
    // `test/engagements.e2e-spec.ts`'s own GOS-109 ledger suite) left it
    // changed. Same defensive-reset pattern that suite's own `beforeEach`
    // already establishes.
    await prisma.platformSetting.upsert({
      where: { key: 'payments.general-settings.commission.percent' },
      update: { value: '10' },
      create: {
        key: 'payments.general-settings.commission.percent',
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
    const email = uniqueEmail('cash-payment');
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

  async function seedApprovedCustomer(): Promise<{
    email: string;
    customerProfileId: string;
  }> {
    const { email, userId } = await seedUser();
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId,
        firstName: 'Cliente',
        lastName: 'de Prueba',
        country: CountryCode.AR,
      },
    });
    return { email, customerProfileId: customerProfile.id };
  }

  async function seedApprovedProfessional(categoryIds: string[]): Promise<{
    email: string;
    professionalProfileId: string;
  }> {
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

  /** Full ServiceRequest -> Quote -> accept flow — a real Engagement, not a
   * hand-inserted row. `price` is configurable so `myPendingCashCommissionDebt`
   * tests can seed distinct, known amounts. */
  async function seedEngagement(price = 5000): Promise<{
    engagementId: string;
    customerToken: string;
    professionalToken: string;
    professionalProfileId: string;
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

    return {
      engagementId,
      customerToken,
      professionalToken,
      professionalProfileId: professional.professionalProfileId,
    };
  }

  /** Propose (Customer) -> accept (Professional) -> startEngagementWork, so
   * the Engagement reaches IN_PROGRESS (confirmable for cash payment).
   * `startsAt`/`endsAt` are overridable — the same Professional can only
   * hold ONE CONFIRMED Appointment per time slot (a real DB EXCLUDE
   * constraint), so seeding more than one IN_PROGRESS Engagement for the
   * same Professional requires distinct slots. */
  async function driveToInProgress(
    engagementId: string,
    customerToken: string,
    professionalToken: string,
    slot: { startsAt: string; endsAt: string } = {
      startsAt: '2026-09-15T10:00:00.000Z',
      endsAt: '2026-09-15T12:00:00.000Z',
    },
  ): Promise<void> {
    const proposeResponse = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: slot,
      },
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

  async function seedInProgressEngagement(price = 5000): Promise<{
    engagementId: string;
    customerToken: string;
    professionalToken: string;
    professionalProfileId: string;
  }> {
    const seeded = await seedEngagement(price);
    await driveToInProgress(
      seeded.engagementId,
      seeded.customerToken,
      seeded.professionalToken,
    );
    return seeded;
  }

  describe('confirmCashPayment', () => {
    it('only the Customer confirms: no CASH_COMMISSION_DEBT LedgerEntry yet, but Engagement.paymentMethod is set to CASH', async () => {
      const { engagementId, customerToken } = await seedInProgressEngagement();

      const response = await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: { confirmCashPayment: CashPaymentConfirmationPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data?.confirmCashPayment.customerConfirmedAt).not.toBeNull();
      expect(body.data?.confirmCashPayment.professionalConfirmedAt).toBeNull();
      expect(body.data?.confirmCashPayment.commissionDebtRecorded).toBe(false);

      const engagementRow = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(engagementRow?.paymentMethod).toBe('CASH');

      const entries = await prisma.ledgerEntry.findMany({
        where: { engagementId },
      });
      expect(entries).toHaveLength(0);
    });

    it('only the Professional confirms: no LedgerEntry either', async () => {
      const { engagementId, professionalToken } =
        await seedInProgressEngagement();

      await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      const entries = await prisma.ledgerEntry.findMany({
        where: { engagementId },
      });
      expect(entries).toHaveLength(0);
    });

    it('both confirm (Customer then Professional): exactly ONE correct CASH_COMMISSION_DEBT LedgerEntry (10% of the quoted price)', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement(5000);

      await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);
      const secondResponse = await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);
      const secondBody = secondResponse.body as {
        data: { confirmCashPayment: CashPaymentConfirmationPayload };
      };
      expect(secondBody.data.confirmCashPayment.commissionDebtRecorded).toBe(
        true,
      );

      const entries = await prisma.ledgerEntry.findMany({
        where: { engagementId },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'CASH_COMMISSION_DEBT',
        amount: 500,
        currency: 'ARS',
        commissionPercentApplied: 10,
      });
    });

    it('both confirm in the OPPOSITE order (Professional then Customer): still exactly ONE LedgerEntry', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement(5000);

      await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);
      await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      const entries = await prisma.ledgerEntry.findMany({
        where: { engagementId, type: 'CASH_COMMISSION_DEBT' },
      });
      expect(entries).toHaveLength(1);
    });

    it('confirming twice from the SAME party is a no-op re-stamp, never an error, and never duplicates the LedgerEntry', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement(5000);

      await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);
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
      const repeatResponse = await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      expect(
        (
          repeatResponse.body as {
            data: { confirmCashPayment: CashPaymentConfirmationPayload };
          }
        ).data.confirmCashPayment.commissionDebtRecorded,
      ).toBe(true);

      const entries = await prisma.ledgerEntry.findMany({
        where: { engagementId, type: 'CASH_COMMISSION_DEBT' },
      });
      expect(entries).toHaveLength(1);

      const confirmationRows = await prisma.paymentAttempt.findMany({
        where: { engagementId, method: 'CASH' },
      });
      expect(confirmationRows).toHaveLength(1);
    });

    it('a near-simultaneous race of both confirmations writes exactly ONE LedgerEntry, never two', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement(5000);

      await Promise.all([
        gqlRequest(
          CONFIRM_CASH_PAYMENT_MUTATION,
          { engagementId },
          customerToken,
        ),
        gqlRequest(
          CONFIRM_CASH_PAYMENT_MUTATION,
          { engagementId },
          professionalToken,
        ),
      ]);

      const entries = await prisma.ledgerEntry.findMany({
        where: { engagementId, type: 'CASH_COMMISSION_DEBT' },
      });
      expect(entries).toHaveLength(1);

      const confirmationRows = await prisma.paymentAttempt.findMany({
        where: { engagementId, method: 'CASH' },
      });
      expect(confirmationRows).toHaveLength(1);
      expect(confirmationRows[0].customerConfirmedAt).not.toBeNull();
      expect(confirmationRows[0].professionalConfirmedAt).not.toBeNull();
    });

    it('rejects with ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT while still ACCEPTED', async () => {
      const { engagementId, customerToken } = await seedEngagement();

      const response = await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT',
      );
    });

    it('rejects with ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT once CANCELLED', async () => {
      const { engagementId, customerToken } = await seedEngagement();
      await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'no longer needed' },
        customerToken,
      ).expect(200);

      const response = await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT',
      );
    });

    it('rejects an unrelated third party with ENGAGEMENT_NOT_FOUND (anti-enumeration)', async () => {
      const { engagementId } = await seedInProgressEngagement();
      const outsiderCategoryId = await seedCategory();
      const outsider = await seedApprovedProfessional([outsiderCategoryId]);
      const outsiderToken = await loginSessionToken(outsider.email);

      const response = await gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        outsiderToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    describe('payments.payment-methods.cash.enabled kill switch', () => {
      afterEach(async () => {
        await prisma.platformSetting.upsert({
          where: { key: CASH_PAYMENT_ENABLED_KEY },
          update: { value: 'true' },
          create: {
            key: CASH_PAYMENT_ENABLED_KEY,
            description: 'Global kill switch for the Cash Payment capability.',
            valueType: 'BOOLEAN',
            value: 'true',
            isPublic: false,
          },
        });
      });

      it('rejects confirmCashPayment with CASH_PAYMENT_MODULE_DISABLED when the flag is off', async () => {
        const { engagementId, customerToken } =
          await seedInProgressEngagement();

        await prisma.platformSetting.upsert({
          where: { key: CASH_PAYMENT_ENABLED_KEY },
          update: { value: 'false' },
          create: {
            key: CASH_PAYMENT_ENABLED_KEY,
            description: 'Global kill switch for the Cash Payment capability.',
            valueType: 'BOOLEAN',
            value: 'false',
            isPublic: false,
          },
        });

        const response = await gqlRequest(
          CONFIRM_CASH_PAYMENT_MUTATION,
          { engagementId },
          customerToken,
        ).expect(200);

        expect(errorCode(response.body)).toBe('CASH_PAYMENT_MODULE_DISABLED');
      });
    });
  });

  describe('myPendingCashCommissionDebt', () => {
    it('sums CASH_COMMISSION_DEBT across multiple jobs for the same Professional', async () => {
      const categoryId = await seedCategory();
      const customerA = await seedApprovedCustomer();
      const customerB = await seedApprovedCustomer();
      const professional = await seedApprovedProfessional([categoryId]);
      const professionalToken = await loginSessionToken(professional.email);

      async function seedAndCompleteCash(
        customerToken: string,
        price: number,
        slot: { startsAt: string; endsAt: string },
      ): Promise<void> {
        const publishResponse = await gqlRequest(
          PUBLISH_SERVICE_REQUEST_MUTATION,
          {
            input: {
              category: categoryId,
              description: 'Reparación varia en el hogar.',
              urgency: 'FLEXIBLE',
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
          { input: { serviceRequestId, price, message: 'Puedo hacerlo.' } },
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

        await driveToInProgress(
          engagementId,
          customerToken,
          professionalToken,
          slot,
        );

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
      }

      const customerAToken = await loginSessionToken(customerA.email);
      const customerBToken = await loginSessionToken(customerB.email);
      // Distinct time slots — the same Professional can't hold two
      // CONFIRMED Appointments that overlap.
      await seedAndCompleteCash(customerAToken, 5000, {
        startsAt: '2026-09-16T10:00:00.000Z',
        endsAt: '2026-09-16T12:00:00.000Z',
      }); // 500 commission
      await seedAndCompleteCash(customerBToken, 2000, {
        startsAt: '2026-09-17T10:00:00.000Z',
        endsAt: '2026-09-17T12:00:00.000Z',
      }); // 200 commission

      const response = await gqlRequest(
        MY_PENDING_CASH_COMMISSION_DEBT_QUERY,
        {},
        professionalToken,
      ).expect(200);
      const body = response.body as {
        data: { myPendingCashCommissionDebt: number };
      };

      expect(body.data.myPendingCashCommissionDebt).toBeGreaterThanOrEqual(700);
    });

    it('rejects with PROFESSIONAL_PROFILE_REQUIRED for a caller with no ProfessionalProfile', async () => {
      const customer = await seedApprovedCustomer();
      const customerToken = await loginSessionToken(customer.email);

      const response = await gqlRequest(
        MY_PENDING_CASH_COMMISSION_DEBT_QUERY,
        {},
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('PROFESSIONAL_PROFILE_REQUIRED');
    });

    it('is NOT gated by payments.payment-methods.cash.enabled', async () => {
      const categoryId = await seedCategory();
      const professional = await seedApprovedProfessional([categoryId]);
      const professionalToken = await loginSessionToken(professional.email);

      await prisma.platformSetting.upsert({
        where: { key: CASH_PAYMENT_ENABLED_KEY },
        update: { value: 'false' },
        create: {
          key: CASH_PAYMENT_ENABLED_KEY,
          description: 'Global kill switch for the Cash Payment capability.',
          valueType: 'BOOLEAN',
          value: 'false',
          isPublic: false,
        },
      });

      const response = await gqlRequest(
        MY_PENDING_CASH_COMMISSION_DEBT_QUERY,
        {},
        professionalToken,
      ).expect(200);

      expect(errorCode(response.body)).toBeUndefined();

      await prisma.platformSetting.upsert({
        where: { key: CASH_PAYMENT_ENABLED_KEY },
        update: { value: 'true' },
        create: {
          key: CASH_PAYMENT_ENABLED_KEY,
          description: 'Global kill switch for the Cash Payment capability.',
          valueType: 'BOOLEAN',
          value: 'true',
          isPublic: false,
        },
      });
    });
  });

  describe('myCashPaymentConfirmation (GOS-80 follow-up)', () => {
    async function readState(
      engagementId: string,
      token: string,
    ): Promise<CashPaymentConfirmationStatePayload> {
      const response = await gqlRequest(
        MY_CASH_PAYMENT_CONFIRMATION_QUERY,
        { engagementId },
        token,
      ).expect(200);
      const body = response.body as {
        data: {
          myCashPaymentConfirmation: CashPaymentConfirmationStatePayload;
        };
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
      return body.data.myCashPaymentConfirmation;
    }

    function confirm(engagementId: string, token: string) {
      return gqlRequest(
        CONFIRM_CASH_PAYMENT_MUTATION,
        { engagementId },
        token,
      ).expect(200);
    }

    it('rejects an unauthenticated caller', async () => {
      const { engagementId } = await seedInProgressEngagement();

      const response = await gqlRequest(MY_CASH_PAYMENT_CONFIRMATION_QUERY, {
        engagementId,
      }).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors?.length).toBeGreaterThan(0);
      expect(body.data ?? null).toBeNull();
    });

    it('an unrelated third party (even with a Customer profile) gets ENGAGEMENT_NOT_FOUND — same as a nonexistent Engagement', async () => {
      const { engagementId } = await seedInProgressEngagement();
      const stranger = await seedApprovedCustomer();
      const strangerToken = await loginSessionToken(stranger.email);

      const foreign = await gqlRequest(
        MY_CASH_PAYMENT_CONFIRMATION_QUERY,
        { engagementId },
        strangerToken,
      ).expect(200);
      const missing = await gqlRequest(
        MY_CASH_PAYMENT_CONFIRMATION_QUERY,
        { engagementId: '00000000-0000-4000-8000-000000000000' },
        strangerToken,
      ).expect(200);

      expect(errorCode(foreign.body)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(errorCode(missing.body)).toBe('ENGAGEMENT_NOT_FOUND');
      expect(
        (foreign.body as { errors: GraphQLErrorEntry[] }).errors[0].message,
      ).toBe(
        (missing.body as { errors: GraphQLErrorEntry[] }).errors[0].message,
      );
    });

    it('before any confirmation: both parties read all-false, each with their own viewerRole', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement();

      expect(await readState(engagementId, customerToken)).toEqual({
        engagementId,
        viewerRole: 'CUSTOMER',
        customerConfirmed: false,
        professionalConfirmed: false,
        bothConfirmed: false,
      });
      expect(await readState(engagementId, professionalToken)).toEqual({
        engagementId,
        viewerRole: 'PROFESSIONAL',
        customerConfirmed: false,
        professionalConfirmed: false,
        bothConfirmed: false,
      });
    });

    it('Customer confirms first: both parties read the same server truth (customer true, professional false, both false); repeated reads are stable', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement();

      await confirm(engagementId, customerToken);

      for (let i = 0; i < 2; i++) {
        expect(await readState(engagementId, customerToken)).toMatchObject({
          viewerRole: 'CUSTOMER',
          customerConfirmed: true,
          professionalConfirmed: false,
          bothConfirmed: false,
        });
        expect(await readState(engagementId, professionalToken)).toMatchObject({
          viewerRole: 'PROFESSIONAL',
          customerConfirmed: true,
          professionalConfirmed: false,
          bothConfirmed: false,
        });
      }
    });

    it('Professional confirms second: both parties read bothConfirmed = true', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement();

      await confirm(engagementId, customerToken);
      await confirm(engagementId, professionalToken);

      for (const token of [customerToken, professionalToken]) {
        expect(await readState(engagementId, token)).toMatchObject({
          customerConfirmed: true,
          professionalConfirmed: true,
          bothConfirmed: true,
        });
      }
    });

    it('reverse order (Professional first, then Customer) works too', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement();

      await confirm(engagementId, professionalToken);
      expect(await readState(engagementId, customerToken)).toMatchObject({
        customerConfirmed: false,
        professionalConfirmed: true,
        bothConfirmed: false,
      });

      await confirm(engagementId, customerToken);
      for (const token of [customerToken, professionalToken]) {
        expect(await readState(engagementId, token)).toMatchObject({
          customerConfirmed: true,
          professionalConfirmed: true,
          bothConfirmed: true,
        });
      }
    });

    it('repeated (idempotent) confirmation never changes the read state, and it survives a fresh login', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedInProgressEngagement();

      await confirm(engagementId, customerToken);
      await confirm(engagementId, customerToken);
      expect(await readState(engagementId, professionalToken)).toMatchObject({
        customerConfirmed: true,
        professionalConfirmed: false,
        bothConfirmed: false,
      });

      await confirm(engagementId, professionalToken);
      await confirm(engagementId, professionalToken);
      await confirm(engagementId, customerToken);

      const engagementRow = await prisma.engagement.findUniqueOrThrow({
        where: { id: engagementId },
        include: { customerProfile: { include: { user: true } } },
      });
      const freshCustomerToken = await loginSessionToken(
        engagementRow.customerProfile.user.email,
      );
      expect(await readState(engagementId, freshCustomerToken)).toMatchObject({
        customerConfirmed: true,
        professionalConfirmed: true,
        bothConfirmed: true,
      });
    });

    it('a dual-role account resolves its role from the Engagement itself: PROFESSIONAL here, even though it also holds a Customer profile', async () => {
      const { engagementId, customerToken, professionalProfileId } =
        await seedInProgressEngagement();
      const professionalProfile =
        await prisma.professionalProfile.findUniqueOrThrow({
          where: { id: professionalProfileId },
          include: { user: true },
        });
      await prisma.customerProfile.create({
        data: {
          userId: professionalProfile.userId,
          firstName: 'Doble',
          lastName: 'Rol',
          country: CountryCode.AR,
        },
      });
      const dualToken = await loginSessionToken(professionalProfile.user.email);

      await confirm(engagementId, customerToken);

      expect(await readState(engagementId, dualToken)).toMatchObject({
        viewerRole: 'PROFESSIONAL',
        customerConfirmed: true,
        professionalConfirmed: false,
      });
    });

    it('is NOT gated by the cash kill switch (reads existing state)', async () => {
      const { engagementId, customerToken } = await seedInProgressEngagement();
      await confirm(engagementId, customerToken);

      await prisma.platformSetting.update({
        where: { key: CASH_PAYMENT_ENABLED_KEY },
        data: { value: 'false' },
      });
      try {
        expect(await readState(engagementId, customerToken)).toMatchObject({
          customerConfirmed: true,
        });
      } finally {
        await prisma.platformSetting.update({
          where: { key: CASH_PAYMENT_ENABLED_KEY },
          data: { value: 'true' },
        });
      }
    });
  });
});
