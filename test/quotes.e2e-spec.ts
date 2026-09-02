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

const PUBLISH_SERVICE_REQUEST_MUTATION = `
  mutation PublishServiceRequest($input: PublishServiceRequestInput!) {
    publishServiceRequest(input: $input) { id status }
  }
`;

const QUOTE_FIELDS = `
  id serviceRequestId professionalProfileId price message status
  createdAt updatedAt
  professionalProfile { id firstName lastName displayName }
  engagement { id status }
`;

const SUBMIT_QUOTE_MUTATION = `
  mutation SubmitQuote($input: SubmitQuoteInput!) {
    submitQuote(input: $input) { ${QUOTE_FIELDS} }
  }
`;

const WITHDRAW_QUOTE_MUTATION = `
  mutation WithdrawQuote($quoteId: ID!) {
    withdrawQuote(quoteId: $quoteId) { ${QUOTE_FIELDS} }
  }
`;

const REJECT_QUOTE_MUTATION = `
  mutation RejectQuote($quoteId: ID!) {
    rejectQuote(quoteId: $quoteId) { ${QUOTE_FIELDS} }
  }
`;

const ACCEPT_QUOTE_MUTATION = `
  mutation AcceptQuote($quoteId: ID!) {
    acceptQuote(quoteId: $quoteId) {
      id status
      acceptedQuote { id status }
      engagement { id status customerProfileId professionalProfileId }
    }
  }
`;

const QUOTES_FOR_SERVICE_REQUEST_QUERY = `
  query QuotesForServiceRequest($serviceRequestId: ID!) {
    quotesForServiceRequest(serviceRequestId: $serviceRequestId) { ${QUOTE_FIELDS} }
  }
`;

const MY_QUOTES_QUERY = `
  query MyQuotes {
    myQuotes { ${QUOTE_FIELDS} }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface LoginResponseBody {
  data: { login: { userId: string; sessionToken: string } } | null;
}

interface QuotePayload {
  id: string;
  serviceRequestId: string;
  professionalProfileId: string;
  price: number;
  message: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  professionalProfile: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string | null;
  };
  engagement: { id: string; status: string } | null;
}

interface QuoteResponseBody<K extends string> {
  data: Record<K, QuotePayload> | null;
  errors?: GraphQLErrorEntry[];
}

interface QuoteListResponseBody<K extends string> {
  data: Record<K, QuotePayload[]> | null;
  errors?: GraphQLErrorEntry[];
}

interface AcceptQuoteResponseBody {
  data: {
    acceptQuote: {
      id: string;
      status: string;
      acceptedQuote: { id: string; status: string } | null;
      engagement: {
        id: string;
        status: string;
        customerProfileId: string;
        professionalProfileId: string;
      } | null;
    };
  } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `quotes-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for GOS-41 (submit/withdraw/list Quotes, plus the
 * accept/reject/Engagement flow). Same "ad hoc seedX() helper, no shared
 * factory library" convention every other e2e spec in this suite uses —
 * see `test/service-requests.e2e-spec.ts` (the closest sibling, whose
 * ownership/anti-enumeration conventions this file mirrors 1:1).
 */
describe('GraphQL Quote/Engagement (GOS-41, e2e)', () => {
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
        firstName: 'Cliente',
        lastName: 'de Prueba',
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

  async function publishServiceRequest(
    customerToken: string,
    categoryId: string,
  ): Promise<string> {
    const response = await gqlRequest(
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
    const body = response.body as {
      data: { publishServiceRequest: { id: string; status: string } } | null;
    };
    return body.data!.publishServiceRequest.id;
  }

  async function setUpCustomerAndOpenServiceRequest(): Promise<{
    customerToken: string;
    serviceRequestId: string;
    categoryId: string;
  }> {
    const [categoryId] = await seedCategories(1);
    const customer = await seedApprovedCustomer();
    const customerToken = await loginSessionToken(customer.email);
    const serviceRequestId = await publishServiceRequest(
      customerToken,
      categoryId,
    );
    return { customerToken, serviceRequestId, categoryId };
  }

  function submitInput(
    serviceRequestId: string,
    overrides?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      serviceRequestId,
      price: 5000,
      message: 'Puedo hacerlo mañana temprano.',
      ...overrides,
    };
  }

  // 1. Professional submits a Quote against an OPEN ServiceRequest.
  it('an APPROVED Professional can submit a Quote against an OPEN ServiceRequest', async () => {
    const { serviceRequestId, categoryId } =
      await setUpCustomerAndOpenServiceRequest();
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const response = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId) },
      professionalToken,
    ).expect(200);
    const body = response.body as QuoteResponseBody<'submitQuote'>;

    expect(body.errors).toBeUndefined();
    expect(body.data?.submitQuote).toMatchObject({
      serviceRequestId,
      status: 'SENT',
      price: 5000,
    });
  });

  // 2. Professional without a ProfessionalProfile cannot submit.
  it('a user with no ProfessionalProfile cannot submit a Quote -> PROFESSIONAL_PROFILE_REQUIRED', async () => {
    const { serviceRequestId } = await setUpCustomerAndOpenServiceRequest();
    const { email } = await seedUser(UserAccountStatus.APPROVED);
    const sessionToken = await loginSessionToken(email);

    const response = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId) },
      sessionToken,
    ).expect(200);
    const body = response.body as QuoteResponseBody<'submitQuote'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'PROFESSIONAL_PROFILE_REQUIRED',
    );
  });

  // 3. Submitting against a nonexistent ServiceRequest.
  it('submitting a Quote against a nonexistent ServiceRequest -> SERVICE_REQUEST_NOT_FOUND', async () => {
    const [categoryId] = await seedCategories(1);
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);
    const nonexistentId = '00000000-0000-4000-8000-000000000000';

    const response = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(nonexistentId) },
      professionalToken,
    ).expect(200);
    const body = response.body as QuoteResponseBody<'submitQuote'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'SERVICE_REQUEST_NOT_FOUND',
    );
  });

  // 4. Submitting against a non-OPEN ServiceRequest.
  it('submitting a Quote against a CANCELLED ServiceRequest -> SERVICE_REQUEST_NOT_OPEN', async () => {
    const { customerToken, serviceRequestId, categoryId } =
      await setUpCustomerAndOpenServiceRequest();
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    await gqlRequest(
      `mutation Cancel($serviceRequestId: ID!) { cancelServiceRequest(serviceRequestId: $serviceRequestId) { id status } }`,
      { serviceRequestId },
      customerToken,
    ).expect(200);

    const response = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId) },
      professionalToken,
    ).expect(200);
    const body = response.body as QuoteResponseBody<'submitQuote'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('SERVICE_REQUEST_NOT_OPEN');
  });

  // 5. Invalid price.
  it('submitting a Quote with price <= 0 -> INVALID_QUOTE_PRICE', async () => {
    const { serviceRequestId, categoryId } =
      await setUpCustomerAndOpenServiceRequest();
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const response = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId, { price: 0 }) },
      professionalToken,
    ).expect(200);
    const body = response.body as QuoteResponseBody<'submitQuote'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('INVALID_QUOTE_PRICE');
  });

  // 6. Professional withdraws their own SENT Quote.
  it('a Professional can withdraw their own SENT Quote', async () => {
    const { serviceRequestId, categoryId } =
      await setUpCustomerAndOpenServiceRequest();
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const submitted = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId) },
      professionalToken,
    ).expect(200);
    const submittedBody = submitted.body as QuoteResponseBody<'submitQuote'>;
    const quoteId = submittedBody.data!.submitQuote.id;

    const response = await gqlRequest(
      WITHDRAW_QUOTE_MUTATION,
      { quoteId },
      professionalToken,
    ).expect(200);
    const body = response.body as QuoteResponseBody<'withdrawQuote'>;

    expect(body.errors).toBeUndefined();
    expect(body.data?.withdrawQuote.status).toBe('WITHDRAWN');
  });

  // 7. A Professional cannot withdraw another Professional's Quote.
  it("a Professional cannot withdraw another Professional's Quote -> QUOTE_NOT_FOUND", async () => {
    const { serviceRequestId, categoryId } =
      await setUpCustomerAndOpenServiceRequest();
    const owner = await seedApprovedProfessional([categoryId]);
    const ownerToken = await loginSessionToken(owner.email);
    const attacker = await seedApprovedProfessional([categoryId]);
    const attackerToken = await loginSessionToken(attacker.email);

    const submitted = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId) },
      ownerToken,
    ).expect(200);
    const submittedBody = submitted.body as QuoteResponseBody<'submitQuote'>;
    const quoteId = submittedBody.data!.submitQuote.id;

    const response = await gqlRequest(
      WITHDRAW_QUOTE_MUTATION,
      { quoteId },
      attackerToken,
    ).expect(200);
    const body = response.body as QuoteResponseBody<'withdrawQuote'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('QUOTE_NOT_FOUND');
  });

  // 8. Withdrawing twice.
  it('withdrawing an already-WITHDRAWN Quote -> QUOTE_NOT_SENT', async () => {
    const { serviceRequestId, categoryId } =
      await setUpCustomerAndOpenServiceRequest();
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    const submitted = await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId) },
      professionalToken,
    ).expect(200);
    const submittedBody = submitted.body as QuoteResponseBody<'submitQuote'>;
    const quoteId = submittedBody.data!.submitQuote.id;

    await gqlRequest(
      WITHDRAW_QUOTE_MUTATION,
      { quoteId },
      professionalToken,
    ).expect(200);

    const response = await gqlRequest(
      WITHDRAW_QUOTE_MUTATION,
      { quoteId },
      professionalToken,
    ).expect(200);
    const body = response.body as QuoteResponseBody<'withdrawQuote'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('QUOTE_NOT_SENT');
  });

  // 9. quotesForServiceRequest — Customer's own view.
  it("quotesForServiceRequest returns every Quote on the caller's own ServiceRequest", async () => {
    const { customerToken, serviceRequestId, categoryId } =
      await setUpCustomerAndOpenServiceRequest();
    const professional = await seedApprovedProfessional([categoryId]);
    const professionalToken = await loginSessionToken(professional.email);

    await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId) },
      professionalToken,
    ).expect(200);

    const response = await gqlRequest(
      QUOTES_FOR_SERVICE_REQUEST_QUERY,
      { serviceRequestId },
      customerToken,
    ).expect(200);
    const body =
      response.body as QuoteListResponseBody<'quotesForServiceRequest'>;

    expect(body.data?.quotesForServiceRequest).toHaveLength(1);
  });

  // 10. quotesForServiceRequest ownership boundary.
  it("quotesForServiceRequest rejects another customer's ServiceRequest -> SERVICE_REQUEST_NOT_FOUND", async () => {
    const { serviceRequestId } = await setUpCustomerAndOpenServiceRequest();
    const attacker = await seedApprovedCustomer();
    const attackerToken = await loginSessionToken(attacker.email);

    const response = await gqlRequest(
      QUOTES_FOR_SERVICE_REQUEST_QUERY,
      { serviceRequestId },
      attackerToken,
    ).expect(200);
    const body =
      response.body as QuoteListResponseBody<'quotesForServiceRequest'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'SERVICE_REQUEST_NOT_FOUND',
    );
  });

  // 11. myQuotes — Professional's own view.
  it("myQuotes returns only the caller's own Quotes", async () => {
    const { serviceRequestId, categoryId } =
      await setUpCustomerAndOpenServiceRequest();
    const professionalA = await seedApprovedProfessional([categoryId]);
    const tokenA = await loginSessionToken(professionalA.email);
    const professionalB = await seedApprovedProfessional([categoryId]);
    const tokenB = await loginSessionToken(professionalB.email);

    await gqlRequest(
      SUBMIT_QUOTE_MUTATION,
      { input: submitInput(serviceRequestId) },
      tokenA,
    ).expect(200);

    const response = await gqlRequest(MY_QUOTES_QUERY, {}, tokenB).expect(200);
    const body = response.body as QuoteListResponseBody<'myQuotes'>;

    expect(body.data?.myQuotes).toHaveLength(0);
  });

  it('submitQuote without an Authorization header -> UNAUTHENTICATED', async () => {
    const { serviceRequestId } = await setUpCustomerAndOpenServiceRequest();

    const response = await gqlRequest(SUBMIT_QUOTE_MUTATION, {
      input: submitInput(serviceRequestId),
    }).expect(200);
    const body = response.body as QuoteResponseBody<'submitQuote'>;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  describe('accept flow', () => {
    // 12. Happy path — full accept flow.
    it('acceptQuote transitions ServiceRequest to ENGAGED, the Quote to ACCEPTED, auto-rejects every sibling SENT Quote, and creates an Engagement', async () => {
      const { customerToken, serviceRequestId, categoryId } =
        await setUpCustomerAndOpenServiceRequest();
      const acceptedProfessional = await seedApprovedProfessional([categoryId]);
      const acceptedProfessionalToken = await loginSessionToken(
        acceptedProfessional.email,
      );
      const siblingProfessional = await seedApprovedProfessional([categoryId]);
      const siblingProfessionalToken = await loginSessionToken(
        siblingProfessional.email,
      );

      const acceptedSubmitted = await gqlRequest(
        SUBMIT_QUOTE_MUTATION,
        { input: submitInput(serviceRequestId, { price: 5000 }) },
        acceptedProfessionalToken,
      ).expect(200);
      const acceptedQuoteId = (
        acceptedSubmitted.body as QuoteResponseBody<'submitQuote'>
      ).data!.submitQuote.id;

      const siblingSubmitted = await gqlRequest(
        SUBMIT_QUOTE_MUTATION,
        { input: submitInput(serviceRequestId, { price: 6000 }) },
        siblingProfessionalToken,
      ).expect(200);
      const siblingQuoteId = (
        siblingSubmitted.body as QuoteResponseBody<'submitQuote'>
      ).data!.submitQuote.id;

      const response = await gqlRequest(
        ACCEPT_QUOTE_MUTATION,
        { quoteId: acceptedQuoteId },
        customerToken,
      ).expect(200);
      const body = response.body as AcceptQuoteResponseBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.acceptQuote.status).toBe('ENGAGED');
      expect(body.data?.acceptQuote.acceptedQuote).toMatchObject({
        id: acceptedQuoteId,
        status: 'ACCEPTED',
      });
      expect(body.data?.acceptQuote.engagement).toMatchObject({
        status: 'ACCEPTED',
      });

      const siblingQuote = await prisma.quote.findUnique({
        where: { id: siblingQuoteId },
      });
      expect(siblingQuote?.status).toBe('REJECTED');

      const serviceRequestRow = await prisma.serviceRequest.findUnique({
        where: { id: serviceRequestId },
      });
      expect(serviceRequestRow?.status).toBe('ENGAGED');
      expect(serviceRequestRow?.acceptedQuoteId).toBe(acceptedQuoteId);

      const engagementRow = await prisma.engagement.findUnique({
        where: { serviceRequestId },
      });
      expect(engagementRow).not.toBeNull();
      expect(engagementRow?.quoteId).toBe(acceptedQuoteId);
    });

    // 13. Accepting a non-SENT Quote.
    it('accepting an already-WITHDRAWN Quote -> QUOTE_NOT_SENT', async () => {
      const { customerToken, serviceRequestId, categoryId } =
        await setUpCustomerAndOpenServiceRequest();
      const professional = await seedApprovedProfessional([categoryId]);
      const professionalToken = await loginSessionToken(professional.email);

      const submitted = await gqlRequest(
        SUBMIT_QUOTE_MUTATION,
        { input: submitInput(serviceRequestId) },
        professionalToken,
      ).expect(200);
      const quoteId = (submitted.body as QuoteResponseBody<'submitQuote'>).data!
        .submitQuote.id;

      await gqlRequest(
        WITHDRAW_QUOTE_MUTATION,
        { quoteId },
        professionalToken,
      ).expect(200);

      const response = await gqlRequest(
        ACCEPT_QUOTE_MUTATION,
        { quoteId },
        customerToken,
      ).expect(200);
      const body = response.body as AcceptQuoteResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0]?.extensions?.code).toBe('QUOTE_NOT_SENT');
    });

    // 14. Ownership — a different Customer cannot accept.
    it("a Customer cannot accept a Quote on another Customer's ServiceRequest -> QUOTE_NOT_FOUND", async () => {
      const { serviceRequestId, categoryId } =
        await setUpCustomerAndOpenServiceRequest();
      const professional = await seedApprovedProfessional([categoryId]);
      const professionalToken = await loginSessionToken(professional.email);
      const attacker = await seedApprovedCustomer();
      const attackerToken = await loginSessionToken(attacker.email);

      const submitted = await gqlRequest(
        SUBMIT_QUOTE_MUTATION,
        { input: submitInput(serviceRequestId) },
        professionalToken,
      ).expect(200);
      const quoteId = (submitted.body as QuoteResponseBody<'submitQuote'>).data!
        .submitQuote.id;

      const response = await gqlRequest(
        ACCEPT_QUOTE_MUTATION,
        { quoteId },
        attackerToken,
      ).expect(200);
      const body = response.body as AcceptQuoteResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0]?.extensions?.code).toBe('QUOTE_NOT_FOUND');
    });

    // 15. rejectQuote — explicit Customer rejection.
    it('a Customer can explicitly reject a SENT Quote', async () => {
      const { customerToken, serviceRequestId, categoryId } =
        await setUpCustomerAndOpenServiceRequest();
      const professional = await seedApprovedProfessional([categoryId]);
      const professionalToken = await loginSessionToken(professional.email);

      const submitted = await gqlRequest(
        SUBMIT_QUOTE_MUTATION,
        { input: submitInput(serviceRequestId) },
        professionalToken,
      ).expect(200);
      const quoteId = (submitted.body as QuoteResponseBody<'submitQuote'>).data!
        .submitQuote.id;

      const response = await gqlRequest(
        REJECT_QUOTE_MUTATION,
        { quoteId },
        customerToken,
      ).expect(200);
      const body = response.body as QuoteResponseBody<'rejectQuote'>;

      expect(body.errors).toBeUndefined();
      expect(body.data?.rejectQuote.status).toBe('REJECTED');
    });

    // 16. THE real concurrency test — proves the DB-level CAS guarantee,
    // not just the unit test's faked `count`. Two concurrent acceptQuote
    // calls against two DIFFERENT SENT Quotes on the SAME OPEN
    // ServiceRequest — exactly one must win, and exactly one Engagement
    // row must exist afterward.
    it('two concurrent acceptQuote calls against the same ServiceRequest: exactly one succeeds, exactly one Engagement exists', async () => {
      const { customerToken, serviceRequestId, categoryId } =
        await setUpCustomerAndOpenServiceRequest();
      const professionalA = await seedApprovedProfessional([categoryId]);
      const tokenA = await loginSessionToken(professionalA.email);
      const professionalB = await seedApprovedProfessional([categoryId]);
      const tokenB = await loginSessionToken(professionalB.email);

      const submittedA = await gqlRequest(
        SUBMIT_QUOTE_MUTATION,
        { input: submitInput(serviceRequestId, { price: 5000 }) },
        tokenA,
      ).expect(200);
      const quoteIdA = (submittedA.body as QuoteResponseBody<'submitQuote'>)
        .data!.submitQuote.id;

      const submittedB = await gqlRequest(
        SUBMIT_QUOTE_MUTATION,
        { input: submitInput(serviceRequestId, { price: 6000 }) },
        tokenB,
      ).expect(200);
      const quoteIdB = (submittedB.body as QuoteResponseBody<'submitQuote'>)
        .data!.submitQuote.id;

      const [responseA, responseB] = await Promise.all([
        gqlRequest(ACCEPT_QUOTE_MUTATION, { quoteId: quoteIdA }, customerToken),
        gqlRequest(ACCEPT_QUOTE_MUTATION, { quoteId: quoteIdB }, customerToken),
      ]);

      const bodyA = responseA.body as AcceptQuoteResponseBody;
      const bodyB = responseB.body as AcceptQuoteResponseBody;

      const succeededA =
        !bodyA.errors && bodyA.data?.acceptQuote.status === 'ENGAGED';
      const succeededB =
        !bodyB.errors && bodyB.data?.acceptQuote.status === 'ENGAGED';

      // Exactly one call won.
      expect(succeededA).toBe(!succeededB);
      if (!succeededA) {
        expect(bodyA.errors?.[0]?.extensions?.code).toBe(
          'QUOTE_ACCEPT_CONFLICT',
        );
      }
      if (!succeededB) {
        expect(bodyB.errors?.[0]?.extensions?.code).toBe(
          'QUOTE_ACCEPT_CONFLICT',
        );
      }

      // Exactly one Engagement row exists for this ServiceRequest — the
      // real, DB-level proof of the guarantee (not just the faked `count`
      // the unit test asserts against).
      const engagements = await prisma.engagement.findMany({
        where: { serviceRequestId },
      });
      expect(engagements).toHaveLength(1);

      const winningQuoteId = succeededA ? quoteIdA : quoteIdB;
      expect(engagements[0].quoteId).toBe(winningQuoteId);

      const serviceRequestRow = await prisma.serviceRequest.findUnique({
        where: { id: serviceRequestId },
      });
      expect(serviceRequestRow?.status).toBe('ENGAGED');
      expect(serviceRequestRow?.acceptedQuoteId).toBe(winningQuoteId);
    });
  });
});
