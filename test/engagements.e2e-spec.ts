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
  cleanAppointmentsData,
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
    acceptQuote(quoteId: $quoteId) {
      engagement { id status }
    }
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

const ENGAGEMENT_FIELDS = `
  id status startedAt finishedAt cancelledAt cancelReason customerProfileId professionalProfileId
`;

const START_ENGAGEMENT_WORK_MUTATION = `
  mutation StartEngagementWork($engagementId: ID!) {
    startEngagementWork(engagementId: $engagementId) { ${ENGAGEMENT_FIELDS} }
  }
`;

const MARK_ENGAGEMENT_WORK_FINISHED_MUTATION = `
  mutation MarkEngagementWorkFinished($engagementId: ID!) {
    markEngagementWorkFinished(engagementId: $engagementId) { ${ENGAGEMENT_FIELDS} }
  }
`;

const CONFIRM_ENGAGEMENT_COMPLETION_MUTATION = `
  mutation ConfirmEngagementCompletion($engagementId: ID!) {
    confirmEngagementCompletion(engagementId: $engagementId) { ${ENGAGEMENT_FIELDS} }
  }
`;

const CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION = `
  mutation CancelEngagementByCustomer($engagementId: ID!, $reason: String!) {
    cancelEngagementByCustomer(engagementId: $engagementId, reason: $reason) { ${ENGAGEMENT_FIELDS} }
  }
`;

const MY_ENGAGEMENTS_AS_PROFESSIONAL_QUERY = `
  query {
    myEngagementsAsProfessional { ${ENGAGEMENT_FIELDS} }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface EngagementPayload {
  id: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  customerProfileId: string;
  professionalProfileId: string;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for GOS-111/GOS-113/GOS-114 — the Engagement work-execution
 * state machine: `startEngagementWork` (ACCEPTED -> IN_PROGRESS, requires a
 * CONFIRMED Appointment), `markEngagementWorkFinished` (IN_PROGRESS ->
 * PENDING_CUSTOMER_CONFIRMATION), `confirmEngagementCompletion`
 * (PENDING_CUSTOMER_CONFIRMATION -> COMPLETED, Customer-driven, GOS-113),
 * and `cancelEngagementByCustomer` (ACCEPTED|IN_PROGRESS -> CANCELLED,
 * Customer-driven, GOS-114). Same "ad hoc seedX() helper, no shared factory
 * library" convention as `test/appointments.e2e-spec.ts`, whose
 * `seedEngagement` (publish -> submit -> accept, a real Engagement, never a
 * hand-inserted row) and appointment propose/accept flow are reused here.
 *
 * Runs against the isolated `postgres_test` database (port 5433), never the
 * shared dev Postgres. The `redis` container must be up (@nestjs/throttler).
 */
describe('GraphQL Engagement work execution (GOS-111/113/114, e2e)', () => {
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
    const email = uniqueEmail('engagement');
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

  /**
   * Full ServiceRequest -> Quote -> accept flow (same shape as
   * `quotes.e2e-spec.ts`/`appointments.e2e-spec.ts`) — a real `Engagement`,
   * not a hand-inserted row.
   */
  async function seedEngagement(): Promise<{
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

    return { engagementId, customerToken, professionalToken };
  }

  /** Propose (Customer) then accept (Professional) -> a CONFIRMED Appointment. */
  async function confirmAnAppointment(
    engagementId: string,
    customerToken: string,
    professionalToken: string,
  ): Promise<void> {
    const proposeResponse = await gqlRequest(
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
      proposeResponse.body as {
        data: { proposeAppointment: { id: string } };
      }
    ).data.proposeAppointment.id;

    const acceptResponse = await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      professionalToken,
    ).expect(200);
    const acceptBody = acceptResponse.body as {
      data: { acceptAppointment: { status: string } } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(acceptBody.errors).toBeUndefined();
    expect(acceptBody.data?.acceptAppointment.status).toBe('CONFIRMED');
  }

  function errorCode(body: unknown): string | undefined {
    return (body as { errors?: GraphQLErrorEntry[] }).errors?.[0]?.extensions
      ?.code;
  }

  /**
   * Drives a fresh Engagement all the way to PENDING_CUSTOMER_CONFIRMATION
   * via the real GraphQL flow (seedEngagement -> confirmAnAppointment ->
   * startEngagementWork -> markEngagementWorkFinished), for
   * `confirmEngagementCompletion` tests below.
   */
  async function seedPendingCustomerConfirmationEngagement(): Promise<{
    engagementId: string;
    customerToken: string;
    professionalToken: string;
  }> {
    const { engagementId, customerToken, professionalToken } =
      await seedEngagement();
    await confirmAnAppointment(engagementId, customerToken, professionalToken);
    await gqlRequest(
      START_ENGAGEMENT_WORK_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);
    await gqlRequest(
      MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);
    return { engagementId, customerToken, professionalToken };
  }

  describe('startEngagementWork', () => {
    it('ACCEPTED -> IN_PROGRESS with a CONFIRMED Appointment, stamping startedAt', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await confirmAnAppointment(
        engagementId,
        customerToken,
        professionalToken,
      );

      const response = await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);
      const body = response.body as {
        data: { startEngagementWork: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data?.startEngagementWork.status).toBe('IN_PROGRESS');
      expect(body.data?.startEngagementWork.startedAt).not.toBeNull();
      expect(body.data?.startEngagementWork.finishedAt).toBeNull();

      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe('IN_PROGRESS');
      expect(row?.startedAt).not.toBeNull();
    });

    it('rejects with UNAUTHENTICATED when no session token is provided', async () => {
      const { engagementId } = await seedEngagement();

      const response = await gqlRequest(START_ENGAGEMENT_WORK_MUTATION, {
        engagementId,
      }).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.data).toBeNull();
      expect(errorCode(body)).toBe('UNAUTHENTICATED');
    });

    it('rejects with ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT when there is no appointment at all', async () => {
      const { engagementId, professionalToken } = await seedEngagement();

      const response = await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT',
      );
      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe('ACCEPTED');
      expect(row?.startedAt).toBeNull();
    });

    it('rejects with ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT when the only appointment is still PENDING', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await gqlRequest(
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

      const response = await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT',
      );
    });

    it('rejects the Customer of the Engagement with ENGAGEMENT_NOT_FOUND (anti-enumeration)', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await confirmAnAppointment(
        engagementId,
        customerToken,
        professionalToken,
      );

      const response = await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects an unrelated third-party Professional with ENGAGEMENT_NOT_FOUND', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await confirmAnAppointment(
        engagementId,
        customerToken,
        professionalToken,
      );

      const outsiderCategoryId = await seedCategory();
      const outsider = await seedApprovedProfessional([outsiderCategoryId]);
      const outsiderToken = await loginSessionToken(outsider.email);

      const response = await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        outsiderToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects a random engagementId with ENGAGEMENT_NOT_FOUND', async () => {
      const { professionalToken } = await seedEngagement();

      const response = await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId: '00000000-0000-0000-0000-000000000000' },
        professionalToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('two concurrent startEngagementWork calls: exactly one wins, the other gets ENGAGEMENT_WORK_START_CONFLICT', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await confirmAnAppointment(
        engagementId,
        customerToken,
        professionalToken,
      );

      const [a, b] = await Promise.all([
        gqlRequest(
          START_ENGAGEMENT_WORK_MUTATION,
          { engagementId },
          professionalToken,
        ),
        gqlRequest(
          START_ENGAGEMENT_WORK_MUTATION,
          { engagementId },
          professionalToken,
        ),
      ]);

      const bodyA = a.body as {
        data: { startEngagementWork: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };
      const bodyB = b.body as {
        data: { startEngagementWork: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      const wonA =
        !bodyA.errors &&
        bodyA.data?.startEngagementWork.status === 'IN_PROGRESS';
      const wonB =
        !bodyB.errors &&
        bodyB.data?.startEngagementWork.status === 'IN_PROGRESS';
      expect(wonA).toBe(!wonB);

      const loserCode = wonA ? errorCode(bodyB) : errorCode(bodyA);
      expect(loserCode).toBe('ENGAGEMENT_WORK_START_CONFLICT');

      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe('IN_PROGRESS');
      expect(row?.startedAt).not.toBeNull();
    });

    it('a second sequential startEngagementWork is rejected with ENGAGEMENT_NOT_ACCEPTED', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await confirmAnAppointment(
        engagementId,
        customerToken,
        professionalToken,
      );

      await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);
      const startedAt = (
        await prisma.engagement.findUnique({ where: { id: engagementId } })
      )?.startedAt;

      const second = await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      expect(errorCode(second.body)).toBe('ENGAGEMENT_NOT_ACCEPTED');
      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.startedAt).toEqual(startedAt);
    });
  });

  describe('markEngagementWorkFinished', () => {
    async function seedInProgressEngagement() {
      const seeded = await seedEngagement();
      await confirmAnAppointment(
        seeded.engagementId,
        seeded.customerToken,
        seeded.professionalToken,
      );
      await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId: seeded.engagementId },
        seeded.professionalToken,
      ).expect(200);
      return seeded;
    }

    it('IN_PROGRESS -> PENDING_CUSTOMER_CONFIRMATION, stamping finishedAt and leaving startedAt intact', async () => {
      const { engagementId, professionalToken } =
        await seedInProgressEngagement();
      const startedAt = (
        await prisma.engagement.findUnique({ where: { id: engagementId } })
      )?.startedAt;

      const response = await gqlRequest(
        MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);
      const body = response.body as {
        data: { markEngagementWorkFinished: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data?.markEngagementWorkFinished.status).toBe(
        'PENDING_CUSTOMER_CONFIRMATION',
      );
      expect(body.data?.markEngagementWorkFinished.finishedAt).not.toBeNull();

      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe('PENDING_CUSTOMER_CONFIRMATION');
      expect(row?.finishedAt).not.toBeNull();
      expect(row?.startedAt).toEqual(startedAt);
    });

    it('rejects markEngagementWorkFinished on a never-started (ACCEPTED) Engagement with ENGAGEMENT_NOT_IN_PROGRESS', async () => {
      const { engagementId, professionalToken } = await seedEngagement();

      const response = await gqlRequest(
        MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_IN_PROGRESS');
    });

    it('a second markEngagementWorkFinished is rejected with ENGAGEMENT_NOT_IN_PROGRESS', async () => {
      const { engagementId, professionalToken } =
        await seedInProgressEngagement();

      await gqlRequest(
        MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);
      const second = await gqlRequest(
        MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      expect(errorCode(second.body)).toBe('ENGAGEMENT_NOT_IN_PROGRESS');
    });

    it('rejects the Customer / a third party with ENGAGEMENT_NOT_FOUND', async () => {
      const { engagementId, customerToken } = await seedInProgressEngagement();

      const response = await gqlRequest(
        MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });
  });

  describe('confirmEngagementCompletion', () => {
    it('PENDING_CUSTOMER_CONFIRMATION -> COMPLETED for the owning Customer', async () => {
      const { engagementId, customerToken } =
        await seedPendingCustomerConfirmationEngagement();

      const response = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: { confirmEngagementCompletion: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data?.confirmEngagementCompletion.status).toBe('COMPLETED');

      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe('COMPLETED');
    });

    it('rejects the Professional owner with ENGAGEMENT_NOT_FOUND', async () => {
      const { engagementId, professionalToken } =
        await seedPendingCustomerConfirmationEngagement();

      const response = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects an unrelated third-party Customer with ENGAGEMENT_NOT_FOUND', async () => {
      const { engagementId } =
        await seedPendingCustomerConfirmationEngagement();
      const thirdParty = await seedApprovedCustomer();
      const thirdPartyToken = await loginSessionToken(thirdParty.email);

      const response = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        thirdPartyToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects a random engagementId with ENGAGEMENT_NOT_FOUND', async () => {
      const { customerToken } =
        await seedPendingCustomerConfirmationEngagement();

      const response = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId: '00000000-0000-0000-0000-000000000000' },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects an unauthenticated call with UNAUTHENTICATED', async () => {
      const { engagementId } =
        await seedPendingCustomerConfirmationEngagement();

      const response = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        {
          engagementId,
        },
      ).expect(200);

      expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
    });

    it('rejects an ACCEPTED Engagement with ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION', async () => {
      const { engagementId, customerToken } = await seedEngagement();

      const response = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION',
      );
    });

    it('rejects an IN_PROGRESS Engagement with ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await confirmAnAppointment(
        engagementId,
        customerToken,
        professionalToken,
      );
      await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      const response = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION',
      );
    });

    it('rejects an already-COMPLETED Engagement (second confirm) with ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION', async () => {
      const { engagementId, customerToken } =
        await seedPendingCustomerConfirmationEngagement();
      await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      const second = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      expect(errorCode(second.body)).toBe(
        'ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION',
      );
    });

    it('rejects a CANCELLED Engagement with ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION', async () => {
      const { engagementId, customerToken } = await seedEngagement();
      // GOS-114 shipped a real cancel mutation — drive the CANCELLED
      // fixture through it instead of a direct Prisma write.
      await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'no longer needed' },
        customerToken,
      ).expect(200);

      const response = await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION',
      );
    });

    it('two concurrent confirmEngagementCompletion calls: exactly one wins, the other gets ENGAGEMENT_COMPLETION_CONFLICT', async () => {
      const { engagementId, customerToken } =
        await seedPendingCustomerConfirmationEngagement();

      const [a, b] = await Promise.all([
        gqlRequest(
          CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
          { engagementId },
          customerToken,
        ),
        gqlRequest(
          CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
          { engagementId },
          customerToken,
        ),
      ]);

      const bodyA = a.body as {
        data: { confirmEngagementCompletion: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };
      const bodyB = b.body as {
        data: { confirmEngagementCompletion: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      const wonA =
        !bodyA.errors &&
        bodyA.data?.confirmEngagementCompletion.status === 'COMPLETED';
      const wonB =
        !bodyB.errors &&
        bodyB.data?.confirmEngagementCompletion.status === 'COMPLETED';
      expect(wonA).toBe(!wonB);

      const loserCode = wonA ? errorCode(bodyB) : errorCode(bodyA);
      expect(loserCode).toBe('ENGAGEMENT_COMPLETION_CONFLICT');

      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe('COMPLETED');
    });
  });

  describe('cancelEngagementByCustomer', () => {
    it('ACCEPTED -> CANCELLED for the owning Customer, recording cancelledAt/cancelReason', async () => {
      const { engagementId, customerToken } = await seedEngagement();

      const response = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'Ya no lo necesito' },
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: { cancelEngagementByCustomer: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data?.cancelEngagementByCustomer.status).toBe('CANCELLED');
      expect(body.data?.cancelEngagementByCustomer.cancelledAt).not.toBeNull();
      expect(body.data?.cancelEngagementByCustomer.cancelReason).toBe(
        'Ya no lo necesito',
      );

      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe('CANCELLED');
      expect(row?.cancelledAt).not.toBeNull();
      expect(row?.cancelReason).toBe('Ya no lo necesito');
    });

    it('IN_PROGRESS -> CANCELLED for the owning Customer', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await confirmAnAppointment(
        engagementId,
        customerToken,
        professionalToken,
      );
      await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      const response = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'Cambio de planes' },
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: { cancelEngagementByCustomer: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data?.cancelEngagementByCustomer.status).toBe('CANCELLED');
    });

    it('rejects the Professional owner with ENGAGEMENT_NOT_FOUND (anti-enumeration)', async () => {
      const { engagementId, professionalToken } = await seedEngagement();

      const response = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'x' },
        professionalToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects an unrelated third-party Customer with ENGAGEMENT_NOT_FOUND', async () => {
      const { engagementId } = await seedEngagement();
      const thirdParty = await seedApprovedCustomer();
      const thirdPartyToken = await loginSessionToken(thirdParty.email);

      const response = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'x' },
        thirdPartyToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects a random engagementId with ENGAGEMENT_NOT_FOUND', async () => {
      const { customerToken } = await seedEngagement();

      const response = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        {
          engagementId: '00000000-0000-0000-0000-000000000000',
          reason: 'x',
        },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects an unauthenticated call with UNAUTHENTICATED', async () => {
      const { engagementId } = await seedEngagement();

      const response = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        {
          engagementId,
          reason: 'x',
        },
      ).expect(200);

      expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
    });

    it('rejects a PENDING_CUSTOMER_CONFIRMATION Engagement with ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER', async () => {
      const { engagementId, customerToken } =
        await seedPendingCustomerConfirmationEngagement();

      const response = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'x' },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER',
      );
    });

    it('rejects an already-COMPLETED Engagement with ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER', async () => {
      const { engagementId, customerToken } =
        await seedPendingCustomerConfirmationEngagement();
      await gqlRequest(
        CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
        { engagementId },
        customerToken,
      ).expect(200);

      const response = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'x' },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe(
        'ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER',
      );
    });

    it('rejects an already-CANCELLED Engagement (second cancel) with ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER', async () => {
      const { engagementId, customerToken } = await seedEngagement();
      await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'first' },
        customerToken,
      ).expect(200);

      const second = await gqlRequest(
        CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
        { engagementId, reason: 'second' },
        customerToken,
      ).expect(200);

      expect(errorCode(second.body)).toBe(
        'ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER',
      );
    });

    it('two concurrent cancelEngagementByCustomer calls: exactly one wins, the other gets ENGAGEMENT_CANCEL_CONFLICT', async () => {
      const { engagementId, customerToken } = await seedEngagement();

      const [a, b] = await Promise.all([
        gqlRequest(
          CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
          { engagementId, reason: 'a' },
          customerToken,
        ),
        gqlRequest(
          CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
          { engagementId, reason: 'b' },
          customerToken,
        ),
      ]);

      const bodyA = a.body as {
        data: { cancelEngagementByCustomer: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };
      const bodyB = b.body as {
        data: { cancelEngagementByCustomer: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      const wonA =
        !bodyA.errors &&
        bodyA.data?.cancelEngagementByCustomer.status === 'CANCELLED';
      const wonB =
        !bodyB.errors &&
        bodyB.data?.cancelEngagementByCustomer.status === 'CANCELLED';
      expect(wonA).toBe(!wonB);

      const loserCode = wonA ? errorCode(bodyB) : errorCode(bodyA);
      expect(loserCode).toBe('ENGAGEMENT_CANCEL_CONFLICT');

      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe('CANCELLED');
    });

    it('a race against a concurrent markEngagementWorkFinished: exactly one wins', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedEngagement();
      await confirmAnAppointment(
        engagementId,
        customerToken,
        professionalToken,
      );
      await gqlRequest(
        START_ENGAGEMENT_WORK_MUTATION,
        { engagementId },
        professionalToken,
      ).expect(200);

      const [cancelResponse, finishResponse] = await Promise.all([
        gqlRequest(
          CANCEL_ENGAGEMENT_BY_CUSTOMER_MUTATION,
          { engagementId, reason: 'cliente cancela' },
          customerToken,
        ),
        gqlRequest(
          MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
          { engagementId },
          professionalToken,
        ),
      ]);

      const cancelBody = cancelResponse.body as {
        data: { cancelEngagementByCustomer: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };
      const finishBody = finishResponse.body as {
        data: { markEngagementWorkFinished: EngagementPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      const cancelWon =
        !cancelBody.errors &&
        cancelBody.data?.cancelEngagementByCustomer.status === 'CANCELLED';
      const finishWon =
        !finishBody.errors &&
        finishBody.data?.markEngagementWorkFinished.status ===
          'PENDING_CUSTOMER_CONFIRMATION';
      expect(cancelWon).toBe(!finishWon);

      const row = await prisma.engagement.findUnique({
        where: { id: engagementId },
      });
      expect(row?.status).toBe(
        cancelWon ? 'CANCELLED' : 'PENDING_CUSTOMER_CONFIRMATION',
      );
    });
  });

  it('myEngagementsAsProfessional reflects status/startedAt/finishedAt after each transition', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedEngagement();
    await confirmAnAppointment(engagementId, customerToken, professionalToken);

    const readStatus = async (): Promise<EngagementPayload> => {
      const res = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: MY_ENGAGEMENTS_AS_PROFESSIONAL_QUERY })
        .set('Authorization', `Bearer ${professionalToken}`)
        .expect(200);
      const list = (
        res.body as {
          data: { myEngagementsAsProfessional: EngagementPayload[] };
        }
      ).data.myEngagementsAsProfessional;
      return list.find((e) => e.id === engagementId)!;
    };

    expect((await readStatus()).status).toBe('ACCEPTED');

    await gqlRequest(
      START_ENGAGEMENT_WORK_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);
    const afterStart = await readStatus();
    expect(afterStart.status).toBe('IN_PROGRESS');
    expect(afterStart.startedAt).not.toBeNull();

    await gqlRequest(
      MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);
    const afterFinish = await readStatus();
    expect(afterFinish.status).toBe('PENDING_CUSTOMER_CONFIRMATION');
    expect(afterFinish.finishedAt).not.toBeNull();
  });
});
