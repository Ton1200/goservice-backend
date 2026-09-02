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
import { APPOINTMENTS_ENABLED_KEY } from '../src/appointments/guards/appointments-module-enabled.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanAdminUsersData,
  cleanAppointmentsData,
  cleanProfilesData,
  cleanQuotesAndEngagementsData,
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
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
      engagement { id status customerProfileId professionalProfileId }
    }
  }
`;

const APPOINTMENT_FIELDS = `
  id engagementId professionalProfileId startsAt endsAt status
  proposedByRole cancelReason cancelledAt confirmedAt createdAt updatedAt
`;

const PROPOSE_APPOINTMENT_MUTATION = `
  mutation ProposeAppointment($engagementId: ID!, $input: ProposeAppointmentInput!) {
    proposeAppointment(engagementId: $engagementId, input: $input) { ${APPOINTMENT_FIELDS} }
  }
`;

const ACCEPT_APPOINTMENT_MUTATION = `
  mutation AcceptAppointment($id: ID!) {
    acceptAppointment(id: $id) { ${APPOINTMENT_FIELDS} }
  }
`;

const CANCEL_APPOINTMENT_MUTATION = `
  mutation CancelAppointment($id: ID!, $reason: String!) {
    cancelAppointment(id: $id, reason: $reason) { ${APPOINTMENT_FIELDS} }
  }
`;

const APPOINTMENTS_BY_ENGAGEMENT_QUERY = `
  query AppointmentsByEngagement($engagementId: ID!) {
    appointmentsByEngagement(engagementId: $engagementId) { ${APPOINTMENT_FIELDS} }
  }
`;

const ADMIN_APPOINTMENTS_BY_ENGAGEMENT_QUERY = `
  query AdminAppointmentsByEngagement($engagementId: ID!) {
    adminAppointmentsByEngagement(engagementId: $engagementId) { ${APPOINTMENT_FIELDS} }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface AppointmentPayload {
  id: string;
  engagementId: string;
  professionalProfileId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  proposedByRole: string;
  cancelReason: string | null;
  cancelledAt: string | null;
  confirmedAt: string | null;
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for GOS-59 — Appointment (Coordinación de Visita):
 * `proposeAppointment`/`acceptAppointment`/`cancelAppointment`/
 * `appointmentsByEngagement`, plus the admin `adminAppointmentsByEngagement`
 * audit query. Same "ad hoc seedX() helper, no shared factory library"
 * convention every other e2e spec in this suite uses — closest siblings are
 * `test/quotes.e2e-spec.ts` (Engagement fixture setup: publish -> submit ->
 * accept) and `test/engagement-chat.e2e-spec.ts` (the exact same fixture
 * chain, plus admin login/permission-seeding helpers).
 *
 * This is the load-bearing suite for the whole feature — the ONLY place
 * that exercises the DB `EXCLUDE USING gist` constraint
 * (`appointment_no_overlapping_confirmed_per_professional`) for real,
 * against the isolated `postgres_test` database (never the shared dev
 * Postgres).
 */
describe('GraphQL Appointment (GOS-59, e2e)', () => {
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
    await cleanAdminUsersData(prisma);
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
    const email = uniqueEmail('appointment');
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
        addressLine: 'Calle Falsa 123',
        city: 'CABA',
        province: 'Buenos Aires',
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
    const body = response.body as {
      data: { login: { sessionToken: string } };
    };
    return body.data.login.sessionToken;
  }

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

  async function adminLoginToken(email: string): Promise<string> {
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

  /**
   * Full ServiceRequest -> Quote -> accept flow (same shape as
   * `quotes.e2e-spec.ts`/`engagement-chat.e2e-spec.ts`), so this suite gets
   * a real `Engagement` — not a hand-inserted row.
   *
   * `existingProfessional`, when provided, REUSES that professional's
   * token/id instead of creating a brand-new Professional — this is what
   * lets the mandatory overlap-conflict test create TWO DIFFERENT
   * Engagements for the SAME professional (SubmitQuoteService enforces no
   * category-compatibility check against the ServiceRequest, so any
   * category works here).
   */
  async function seedEngagement(existingProfessional?: {
    email: string;
    token: string;
    professionalProfileId: string;
  }): Promise<{
    engagementId: string;
    customerToken: string;
    professionalToken: string;
    professionalProfileId: string;
  }> {
    const categoryId = await seedCategory();
    const customer = await seedApprovedCustomer();
    const professional =
      existingProfessional ??
      (await (async () => {
        const created = await seedApprovedProfessional([categoryId]);
        const token = await loginSessionToken(created.email);
        return {
          email: created.email,
          token,
          professionalProfileId: created.professionalProfileId,
        };
      })());
    const customerToken = await loginSessionToken(customer.email);

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
      professional.token,
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
      professionalToken: professional.token,
      professionalProfileId: professional.professionalProfileId,
    };
  }

  it('full flow: propose (by Customer) -> accept (by the other party, the Professional) -> CONFIRMED', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedEngagement();

    const proposeResponse = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-09-01T10:00:00.000Z',
          endsAt: '2026-09-01T12:00:00.000Z',
        },
      },
      customerToken,
    ).expect(200);
    const proposeBody = proposeResponse.body as {
      data: { proposeAppointment: AppointmentPayload } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(proposeBody.errors).toBeUndefined();
    expect(proposeBody.data?.proposeAppointment).toMatchObject({
      status: 'PENDING',
      proposedByRole: 'CUSTOMER',
    });
    const appointmentId = proposeBody.data!.proposeAppointment.id;

    const acceptResponse = await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      professionalToken,
    ).expect(200);
    const acceptBody = acceptResponse.body as {
      data: { acceptAppointment: AppointmentPayload } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(acceptBody.errors).toBeUndefined();
    expect(acceptBody.data?.acceptAppointment).toMatchObject({
      id: appointmentId,
      status: 'CONFIRMED',
    });
    expect(acceptBody.data?.acceptAppointment.confirmedAt).not.toBeNull();
  });

  it('either party may propose — a Professional proposing works too', async () => {
    const { engagementId, professionalToken } = await seedEngagement();

    const response = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-09-02T09:00:00.000Z',
          endsAt: '2026-09-02T10:00:00.000Z',
        },
      },
      professionalToken,
    ).expect(200);
    const body = response.body as {
      data: { proposeAppointment: AppointmentPayload } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(body.errors).toBeUndefined();
    expect(body.data?.proposeAppointment.proposedByRole).toBe('PROFESSIONAL');
  });

  it('a third party (neither Customer nor Professional on this Engagement) gets ENGAGEMENT_NOT_FOUND on proposeAppointment', async () => {
    const { engagementId } = await seedEngagement();
    const thirdParty = await seedApprovedCustomer();
    const thirdPartyToken = await loginSessionToken(thirdParty.email);

    const response = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-09-01T10:00:00.000Z',
          endsAt: '2026-09-01T12:00:00.000Z',
        },
      },
      thirdPartyToken,
    ).expect(200);
    const body = response.body as { data: null; errors?: GraphQLErrorEntry[] };

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ENGAGEMENT_NOT_FOUND');
  });

  it('a third party gets APPOINTMENT_NOT_FOUND on acceptAppointment/cancelAppointment and on appointmentsByEngagement gets ENGAGEMENT_NOT_FOUND', async () => {
    const { engagementId, customerToken } = await seedEngagement();
    const proposeResponse = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-09-01T10:00:00.000Z',
          endsAt: '2026-09-01T12:00:00.000Z',
        },
      },
      customerToken,
    ).expect(200);
    const appointmentId = (
      proposeResponse.body as {
        data: { proposeAppointment: AppointmentPayload };
      }
    ).data.proposeAppointment.id;

    const thirdParty = await seedApprovedCustomer();
    const thirdPartyToken = await loginSessionToken(thirdParty.email);

    const acceptResponse = await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      thirdPartyToken,
    ).expect(200);
    expect(
      (acceptResponse.body as { errors?: GraphQLErrorEntry[] }).errors?.[0]
        ?.extensions?.code,
    ).toBe('APPOINTMENT_NOT_FOUND');

    const cancelResponse = await gqlRequest(
      CANCEL_APPOINTMENT_MUTATION,
      { id: appointmentId, reason: 'no autorizado' },
      thirdPartyToken,
    ).expect(200);
    expect(
      (cancelResponse.body as { errors?: GraphQLErrorEntry[] }).errors?.[0]
        ?.extensions?.code,
    ).toBe('APPOINTMENT_NOT_FOUND');

    const listResponse = await gqlRequest(
      APPOINTMENTS_BY_ENGAGEMENT_QUERY,
      { engagementId },
      thirdPartyToken,
    ).expect(200);
    expect(
      (listResponse.body as { errors?: GraphQLErrorEntry[] }).errors?.[0]
        ?.extensions?.code,
    ).toBe('ENGAGEMENT_NOT_FOUND');
  });

  it('the proposer cannot accept their own proposal — APPOINTMENT_CANNOT_ACCEPT_OWN_PROPOSAL', async () => {
    const { engagementId, customerToken } = await seedEngagement();

    const proposeResponse = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-09-01T10:00:00.000Z',
          endsAt: '2026-09-01T12:00:00.000Z',
        },
      },
      customerToken,
    ).expect(200);
    const appointmentId = (
      proposeResponse.body as {
        data: { proposeAppointment: AppointmentPayload };
      }
    ).data.proposeAppointment.id;

    const selfAcceptResponse = await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      customerToken,
    ).expect(200);
    expect(
      (selfAcceptResponse.body as { errors?: GraphQLErrorEntry[] }).errors?.[0]
        ?.extensions?.code,
    ).toBe('APPOINTMENT_CANNOT_ACCEPT_OWN_PROPOSAL');
  });

  it('endsAt <= startsAt is rejected with APPOINTMENT_INVALID_TIME_RANGE', async () => {
    const { engagementId, customerToken } = await seedEngagement();

    const response = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-09-01T12:00:00.000Z',
          endsAt: '2026-09-01T10:00:00.000Z',
        },
      },
      customerToken,
    ).expect(200);
    const body = response.body as { data: null; errors?: GraphQLErrorEntry[] };

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'APPOINTMENT_INVALID_TIME_RANGE',
    );
  });

  /**
   * THE mandatory conflict test from the AC, verbatim: Appointment A
   * 10:00-12:00 confirmed for a professional -> attempt to confirm B
   * 11:00-13:00 SAME professional (a DIFFERENT Engagement) fails with
   * APPOINTMENT_CONFLICT (never a technical error) -> C 13:00-15:00 same
   * professional succeeds. This is what actually exercises the real DB
   * EXCLUDE constraint end-to-end, through the full GraphQL/resolver/
   * service/repository stack, against real postgres_test.
   */
  it('DB-enforced double-booking prevention: overlapping CONFIRMED Appointments for the same professional across different Engagements are rejected with APPOINTMENT_CONFLICT, non-overlapping ones succeed', async () => {
    // Engagement 1, for professional P.
    const engagement1 = await seedEngagement();
    const professional = {
      email: 'reused-professional', // unused field, only token/id matter below
      token: engagement1.professionalToken,
      professionalProfileId: engagement1.professionalProfileId,
    };

    // Engagement 2 and 3, SAME professional P, different Engagements.
    const engagement2 = await seedEngagement(professional);
    const engagement3 = await seedEngagement(professional);

    // --- Appointment A: 10:00-12:00, Engagement 1, confirm it. ---
    const proposeA = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId: engagement1.engagementId,
        input: {
          startsAt: '2026-10-01T10:00:00.000Z',
          endsAt: '2026-10-01T12:00:00.000Z',
        },
      },
      engagement1.customerToken,
    ).expect(200);
    const appointmentAId = (
      proposeA.body as { data: { proposeAppointment: AppointmentPayload } }
    ).data.proposeAppointment.id;

    const acceptA = await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentAId },
      engagement1.professionalToken,
    ).expect(200);
    expect(
      (acceptA.body as { data: { acceptAppointment: AppointmentPayload } }).data
        .acceptAppointment.status,
    ).toBe('CONFIRMED');

    // --- Appointment B: 11:00-13:00, Engagement 2, SAME professional,
    // overlaps A -> must fail with APPOINTMENT_CONFLICT, never a technical
    // error, when confirmed. ---
    const proposeB = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId: engagement2.engagementId,
        input: {
          startsAt: '2026-10-01T11:00:00.000Z',
          endsAt: '2026-10-01T13:00:00.000Z',
        },
      },
      engagement2.customerToken,
    ).expect(200);
    const appointmentBId = (
      proposeB.body as { data: { proposeAppointment: AppointmentPayload } }
    ).data.proposeAppointment.id;

    const acceptB = await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentBId },
      engagement2.professionalToken,
    ).expect(200);
    const acceptBBody = acceptB.body as {
      data: { acceptAppointment: AppointmentPayload } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(acceptBBody.data).toBeNull();
    expect(acceptBBody.errors).toBeDefined();
    expect(acceptBBody.errors?.[0]?.extensions?.code).toBe(
      'APPOINTMENT_CONFLICT',
    );

    // --- Appointment C: 13:00-15:00, Engagement 3, SAME professional, does
    // NOT overlap A (A ends exactly at 12:00, C starts at 13:00) -> must
    // succeed. ---
    const proposeC = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId: engagement3.engagementId,
        input: {
          startsAt: '2026-10-01T13:00:00.000Z',
          endsAt: '2026-10-01T15:00:00.000Z',
        },
      },
      engagement3.customerToken,
    ).expect(200);
    const appointmentCId = (
      proposeC.body as { data: { proposeAppointment: AppointmentPayload } }
    ).data.proposeAppointment.id;

    const acceptC = await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentCId },
      engagement3.professionalToken,
    ).expect(200);
    const acceptCBody = acceptC.body as {
      data: { acceptAppointment: AppointmentPayload } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(acceptCBody.errors).toBeUndefined();
    expect(acceptCBody.data?.acceptAppointment.status).toBe('CONFIRMED');

    // Assert via a real Prisma query (not just the GraphQL responses) that
    // exactly A and C ended up CONFIRMED for this professional, and B
    // stayed PENDING.
    const confirmedForProfessional = await prisma.appointment.findMany({
      where: {
        professionalProfileId: engagement1.professionalProfileId,
        status: 'CONFIRMED',
      },
      select: { id: true },
    });
    expect(confirmedForProfessional.map((row) => row.id).sort()).toEqual(
      [appointmentAId, appointmentCId].sort(),
    );

    const appointmentB = await prisma.appointment.findUnique({
      where: { id: appointmentBId },
    });
    expect(appointmentB?.status).toBe('PENDING');
  });

  it('cancel from PENDING, cancel from CONFIRMED, double-cancel fails, and cancel-then-repropose on the same Engagement succeeds (proves engagementId is not @unique)', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedEngagement();

    // Cancel from PENDING.
    const proposePending = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-11-01T10:00:00.000Z',
          endsAt: '2026-11-01T11:00:00.000Z',
        },
      },
      customerToken,
    ).expect(200);
    const pendingId = (
      proposePending.body as {
        data: { proposeAppointment: AppointmentPayload };
      }
    ).data.proposeAppointment.id;

    const cancelPending = await gqlRequest(
      CANCEL_APPOINTMENT_MUTATION,
      { id: pendingId, reason: 'cambio de planes' },
      customerToken,
    ).expect(200);
    const cancelPendingBody = cancelPending.body as {
      data: { cancelAppointment: AppointmentPayload } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(cancelPendingBody.errors).toBeUndefined();
    expect(cancelPendingBody.data?.cancelAppointment.status).toBe('CANCELLED');
    expect(cancelPendingBody.data?.cancelAppointment.cancelReason).toBe(
      'cambio de planes',
    );

    // Double-cancel -> APPOINTMENT_ALREADY_CANCELLED.
    const doubleCancel = await gqlRequest(
      CANCEL_APPOINTMENT_MUTATION,
      { id: pendingId, reason: 'otra vez' },
      customerToken,
    ).expect(200);
    expect(
      (doubleCancel.body as { errors?: GraphQLErrorEntry[] }).errors?.[0]
        ?.extensions?.code,
    ).toBe('APPOINTMENT_ALREADY_CANCELLED');

    // Cancel-then-repropose on the SAME Engagement — proves engagementId is
    // deliberately not @unique.
    const reproposed = await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-11-02T10:00:00.000Z',
          endsAt: '2026-11-02T11:00:00.000Z',
        },
      },
      professionalToken,
    ).expect(200);
    const reproposedBody = reproposed.body as {
      data: { proposeAppointment: AppointmentPayload } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(reproposedBody.errors).toBeUndefined();
    const confirmedId = reproposedBody.data!.proposeAppointment.id;

    // Cancel from CONFIRMED.
    const confirmIt = await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: confirmedId },
      customerToken,
    ).expect(200);
    expect(
      (confirmIt.body as { data: { acceptAppointment: AppointmentPayload } })
        .data.acceptAppointment.status,
    ).toBe('CONFIRMED');

    const cancelConfirmed = await gqlRequest(
      CANCEL_APPOINTMENT_MUTATION,
      { id: confirmedId, reason: 'imprevisto' },
      professionalToken,
    ).expect(200);
    const cancelConfirmedBody = cancelConfirmed.body as {
      data: { cancelAppointment: AppointmentPayload } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(cancelConfirmedBody.errors).toBeUndefined();
    expect(cancelConfirmedBody.data?.cancelAppointment.status).toBe(
      'CANCELLED',
    );

    // Now the Engagement has accumulated 2 Appointment rows total.
    const listResponse = await gqlRequest(
      APPOINTMENTS_BY_ENGAGEMENT_QUERY,
      { engagementId },
      customerToken,
    ).expect(200);
    const listBody = listResponse.body as {
      data: { appointmentsByEngagement: AppointmentPayload[] };
    };
    expect(listBody.data.appointmentsByEngagement).toHaveLength(2);
  });

  it('an admin WITH APPOINTMENTS_READ can read the full Appointment history for an Engagement', async () => {
    const { engagementId, customerToken } = await seedEngagement();
    await gqlRequest(
      PROPOSE_APPOINTMENT_MUTATION,
      {
        engagementId,
        input: {
          startsAt: '2026-12-01T10:00:00.000Z',
          endsAt: '2026-12-01T11:00:00.000Z',
        },
      },
      customerToken,
    ).expect(200);

    const admin = await seedAdminWithRole('APPOINTMENTS_AUDITOR', [
      Permission.APPOINTMENTS_READ,
    ]);
    const adminToken = await adminLoginToken(admin.email);

    const response = await adminGraphqlRequest(
      adminToken,
      ADMIN_APPOINTMENTS_BY_ENGAGEMENT_QUERY,
      { engagementId },
    ).expect(200);
    const body = response.body as {
      data: { adminAppointmentsByEngagement: AppointmentPayload[] };
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.adminAppointmentsByEngagement).toHaveLength(1);
    expect(body.data.adminAppointmentsByEngagement[0]).toMatchObject({
      status: 'PENDING',
      proposedByRole: 'CUSTOMER',
    });
  });

  it('an admin WITHOUT APPOINTMENTS_READ is rejected — ADMIN_FORBIDDEN', async () => {
    const { engagementId } = await seedEngagement();
    const admin = await seedAdminWithRole('APPOINTMENTS_NO_PERMS', []);
    const adminToken = await adminLoginToken(admin.email);

    const response = await adminGraphqlRequest(
      adminToken,
      ADMIN_APPOINTMENTS_BY_ENGAGEMENT_QUERY,
      { engagementId },
    ).expect(200);
    const body = response.body as {
      data: null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
  });

  /**
   * GOS-59 follow-up — `customer.appointments.enabled` kill switch
   * (`AppointmentsModuleEnabledGuard`). Same mid-test toggle mechanism as
   * `test/password-reset-request.e2e-spec.ts`'s own
   * `notifications.email.resend.enabled` gate describe block: a direct
   * `prisma.platformSetting.upsert` call, never a GraphQL mutation — this
   * suite must not couple itself to the settings-mutation surface.
   * `afterEach` restores the flag back to `'true'` so this suite never
   * leaks state into other e2e files (this row is otherwise fail-open by
   * default per `PlatformSettingPort.isEnabled`'s own doc comment, so
   * restoring is about explicit hygiene for a shared table, not correctness
   * of THIS suite alone).
   */
  describe('customer.appointments.enabled kill switch', () => {
    afterEach(async () => {
      await prisma.platformSetting.upsert({
        where: { key: APPOINTMENTS_ENABLED_KEY },
        update: { value: 'true' },
        create: {
          key: APPOINTMENTS_ENABLED_KEY,
          description: 'Global kill switch for the Appointment capability.',
          valueType: 'BOOLEAN',
          value: 'true',
          isPublic: false,
        },
      });
    });

    it('rejects proposeAppointment with APPOINTMENTS_MODULE_DISABLED when the flag is off', async () => {
      const { engagementId, customerToken } = await seedEngagement();

      await prisma.platformSetting.upsert({
        where: { key: APPOINTMENTS_ENABLED_KEY },
        update: { value: 'false' },
        create: {
          key: APPOINTMENTS_ENABLED_KEY,
          description: 'Global kill switch for the Appointment capability.',
          valueType: 'BOOLEAN',
          value: 'false',
          isPublic: false,
        },
      });

      const response = await gqlRequest(
        PROPOSE_APPOINTMENT_MUTATION,
        {
          engagementId,
          input: {
            startsAt: '2027-01-01T10:00:00.000Z',
            endsAt: '2027-01-01T11:00:00.000Z',
          },
        },
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.data).toBeNull();
      expect(body.errors?.[0]?.extensions?.code).toBe(
        'APPOINTMENTS_MODULE_DISABLED',
      );
    });

    it('proposeAppointment still works with the flag explicitly on (default/seeded)', async () => {
      const { engagementId, customerToken } = await seedEngagement();

      await prisma.platformSetting.upsert({
        where: { key: APPOINTMENTS_ENABLED_KEY },
        update: { value: 'true' },
        create: {
          key: APPOINTMENTS_ENABLED_KEY,
          description: 'Global kill switch for the Appointment capability.',
          valueType: 'BOOLEAN',
          value: 'true',
          isPublic: false,
        },
      });

      const response = await gqlRequest(
        PROPOSE_APPOINTMENT_MUTATION,
        {
          engagementId,
          input: {
            startsAt: '2027-01-02T10:00:00.000Z',
            endsAt: '2027-01-02T11:00:00.000Z',
          },
        },
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: { proposeAppointment: AppointmentPayload } | null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data?.proposeAppointment.status).toBe('PENDING');
    });

    it('adminAppointmentsByEngagement still succeeds with the flag off — proves the admin audit surface is deliberately NOT gated by this guard', async () => {
      const { engagementId, customerToken } = await seedEngagement();

      // Propose an Appointment WHILE the flag is still on (default), so
      // there is real history for the admin query to read once the flag
      // is turned off below.
      await gqlRequest(
        PROPOSE_APPOINTMENT_MUTATION,
        {
          engagementId,
          input: {
            startsAt: '2027-01-03T10:00:00.000Z',
            endsAt: '2027-01-03T11:00:00.000Z',
          },
        },
        customerToken,
      ).expect(200);

      await prisma.platformSetting.upsert({
        where: { key: APPOINTMENTS_ENABLED_KEY },
        update: { value: 'false' },
        create: {
          key: APPOINTMENTS_ENABLED_KEY,
          description: 'Global kill switch for the Appointment capability.',
          valueType: 'BOOLEAN',
          value: 'false',
          isPublic: false,
        },
      });

      const admin = await seedAdminWithRole('APPOINTMENTS_AUDITOR_FLAG_OFF', [
        Permission.APPOINTMENTS_READ,
      ]);
      const adminToken = await adminLoginToken(admin.email);

      const response = await adminGraphqlRequest(
        adminToken,
        ADMIN_APPOINTMENTS_BY_ENGAGEMENT_QUERY,
        { engagementId },
      ).expect(200);
      const body = response.body as {
        data: { adminAppointmentsByEngagement: AppointmentPayload[] };
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data.adminAppointmentsByEngagement).toHaveLength(1);
    });
  });
});
