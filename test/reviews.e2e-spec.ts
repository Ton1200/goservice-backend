import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthProvider,
  CountryCode,
  ProfessionalVerificationStatus,
  ReviewCommentModerationStatus,
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
  cleanReviewsData,
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

const START_ENGAGEMENT_WORK_MUTATION = `
  mutation StartEngagementWork($engagementId: ID!) {
    startEngagementWork(engagementId: $engagementId) { id status }
  }
`;

const MARK_ENGAGEMENT_WORK_FINISHED_MUTATION = `
  mutation MarkEngagementWorkFinished($engagementId: ID!) {
    markEngagementWorkFinished(engagementId: $engagementId) { id status }
  }
`;

const CONFIRM_ENGAGEMENT_COMPLETION_MUTATION = `
  mutation ConfirmEngagementCompletion($engagementId: ID!) {
    confirmEngagementCompletion(engagementId: $engagementId) { id status }
  }
`;

const REVIEW_FIELDS = `id engagementId authorRole rating comment createdAt`;

const SUBMIT_ENGAGEMENT_REVIEW_MUTATION = `
  mutation SubmitEngagementReview($engagementId: ID!, $rating: Int!, $comment: String) {
    submitEngagementReview(engagementId: $engagementId, rating: $rating, comment: $comment) {
      ${REVIEW_FIELDS}
    }
  }
`;

const MY_RECEIVED_REVIEWS_QUERY = `
  query {
    myReceivedReviews { ${REVIEW_FIELDS} }
  }
`;

const QUOTES_FOR_SERVICE_REQUEST_QUERY = `
  query QuotesForServiceRequest($serviceRequestId: ID!) {
    quotesForServiceRequest(serviceRequestId: $serviceRequestId) {
      id
      professionalProfile { id averageRating reviewCount }
    }
  }
`;

const MY_CUSTOMER_PROFILE_RATING_QUERY = `
  query {
    myCustomerProfile { id averageRating reviewCount }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for GOS-121 — mutual Engagement reviews
 * (`submitEngagementReview`/`myReceivedReviews`) and the
 * `ProfessionalProfile.averageRating`/`.reviewCount` field resolver. Runs
 * against the isolated `postgres_test` database (port 5433); the `redis`
 * container must be up. Comment-moderation-dependent scenarios
 * (APPROVED/REJECTED visibility) set `Review.commentModerationStatus`
 * directly via Prisma — driving that state through the real admin GraphQL
 * mutation is covered separately in `admin-reviews.e2e-spec.ts`.
 */
describe('GraphQL Reviews (GOS-121, e2e)', () => {
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

  afterEach(async () => {
    // Restore both review flags to their seeded/enabled default after any
    // test that toggles them off.
    await prisma.platformSetting.updateMany({
      where: {
        key: { in: ['reviews.rating.enabled', 'reviews.comment.enabled'] },
      },
      data: { value: 'true' },
    });
  });

  afterAll(async () => {
    await cleanReviewsData(prisma);
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

  async function ensurePlatformSetting(
    key: string,
    value: string,
  ): Promise<void> {
    await prisma.platformSetting.upsert({
      where: { key },
      update: { value },
      create: {
        key,
        description: 'e2e test setting',
        valueType: 'BOOLEAN',
        value,
        isPublic: false,
      },
    });
  }

  async function seedUser(): Promise<{ email: string; userId: string }> {
    const email = uniqueEmail('review');
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

  async function seedEngagement(): Promise<{
    engagementId: string;
    serviceRequestId: string;
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

    return { engagementId, serviceRequestId, customerToken, professionalToken };
  }

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
      proposeResponse.body as { data: { proposeAppointment: { id: string } } }
    ).data.proposeAppointment.id;

    await gqlRequest(
      ACCEPT_APPOINTMENT_MUTATION,
      { id: appointmentId },
      professionalToken,
    ).expect(200);
  }

  /** Drives a fresh Engagement all the way to COMPLETED via the real
   * GraphQL flow. */
  async function seedCompletedEngagement(): Promise<{
    engagementId: string;
    serviceRequestId: string;
    customerToken: string;
    professionalToken: string;
  }> {
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
    await gqlRequest(
      MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
      { engagementId: seeded.engagementId },
      seeded.professionalToken,
    ).expect(200);
    await gqlRequest(
      CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
      { engagementId: seeded.engagementId },
      seeded.customerToken,
    ).expect(200);
    return seeded;
  }

  function errorCode(body: unknown): string | undefined {
    return (body as { errors?: GraphQLErrorEntry[] }).errors?.[0]?.extensions
      ?.code;
  }

  describe('submitEngagementReview', () => {
    it('both parties can rate each other exactly once — happy path', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedCompletedEngagement();

      const customerReview = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        customerToken,
      ).expect(200);
      const customerBody = customerReview.body as {
        data: {
          submitEngagementReview: { rating: number; authorRole: string };
        } | null;
        errors?: GraphQLErrorEntry[];
      };
      expect(customerBody.errors).toBeUndefined();
      expect(customerBody.data?.submitEngagementReview).toMatchObject({
        rating: 5,
        authorRole: 'CUSTOMER',
      });

      const professionalReview = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 4, comment: null },
        professionalToken,
      ).expect(200);
      const professionalBody = professionalReview.body as {
        data: {
          submitEngagementReview: { rating: number; authorRole: string };
        } | null;
        errors?: GraphQLErrorEntry[];
      };
      expect(professionalBody.errors).toBeUndefined();
      expect(professionalBody.data?.submitEngagementReview).toMatchObject({
        rating: 4,
        authorRole: 'PROFESSIONAL',
      });

      const rows = await prisma.review.findMany({ where: { engagementId } });
      expect(rows).toHaveLength(2);
    });

    it('a second submission from the same party is rejected with ENGAGEMENT_REVIEW_ALREADY_SUBMITTED', async () => {
      const { engagementId, customerToken } = await seedCompletedEngagement();
      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        customerToken,
      ).expect(200);

      const second = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 3, comment: null },
        customerToken,
      ).expect(200);

      expect(errorCode(second.body)).toBe(
        'ENGAGEMENT_REVIEW_ALREADY_SUBMITTED',
      );
      const rows = await prisma.review.findMany({ where: { engagementId } });
      expect(rows).toHaveLength(1);
    });

    it('rejects a non-COMPLETED Engagement with ENGAGEMENT_NOT_COMPLETED', async () => {
      const { engagementId, customerToken } = await seedEngagement();

      const response = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_COMPLETED');
    });

    it.each([0, 6])(
      'rejects rating=%d with INVALID_REVIEW_RATING',
      async (rating) => {
        const { engagementId, customerToken } = await seedCompletedEngagement();

        const response = await gqlRequest(
          SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
          { engagementId, rating, comment: null },
          customerToken,
        ).expect(200);

        expect(errorCode(response.body)).toBe('INVALID_REVIEW_RATING');
      },
    );

    it('rejects an unrelated third party with ENGAGEMENT_NOT_FOUND (anti-enumeration)', async () => {
      const { engagementId } = await seedCompletedEngagement();
      const thirdParty = await seedApprovedCustomer();
      const thirdPartyToken = await loginSessionToken(thirdParty.email);

      const response = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        thirdPartyToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('ENGAGEMENT_NOT_FOUND');
    });

    it('rejects an unauthenticated call with UNAUTHENTICATED', async () => {
      const { engagementId } = await seedCompletedEngagement();

      const response = await gqlRequest(SUBMIT_ENGAGEMENT_REVIEW_MUTATION, {
        engagementId,
        rating: 5,
        comment: null,
      }).expect(200);

      expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
    });

    it('rejects EVERY submission with REVIEWS_MODULE_DISABLED when reviews.rating.enabled=false', async () => {
      const { engagementId, customerToken } = await seedCompletedEngagement();
      await ensurePlatformSetting('reviews.rating.enabled', 'false');

      const response = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        customerToken,
      ).expect(200);

      expect(errorCode(response.body)).toBe('REVIEWS_MODULE_DISABLED');
    });

    it('a rating-only submission still succeeds while reviews.comment.enabled=false, but a non-empty comment is rejected with REVIEW_COMMENTS_DISABLED', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedCompletedEngagement();
      await ensurePlatformSetting('reviews.comment.enabled', 'false');

      const ratingOnly = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        customerToken,
      ).expect(200);
      expect(
        (ratingOnly.body as { errors?: GraphQLErrorEntry[] }).errors,
      ).toBeUndefined();

      const withComment = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 4, comment: 'Muy buen cliente' },
        professionalToken,
      ).expect(200);
      expect(errorCode(withComment.body)).toBe('REVIEW_COMMENTS_DISABLED');
    });

    it('a non-empty comment with reviews.comment.enabled=true is PENDING moderation, and averageRating/reviewCount update immediately, independent of comment moderation', async () => {
      const { engagementId, serviceRequestId, customerToken } =
        await seedCompletedEngagement();

      const response = await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: 'Excelente atención' },
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: { submitEngagementReview: { comment: string | null } } | null;
      };
      // The author's own response always shows the real comment verbatim.
      expect(body.data?.submitEngagementReview.comment).toBe(
        'Excelente atención',
      );

      const row = await prisma.review.findFirst({ where: { engagementId } });
      expect(row?.commentModerationStatus).toBe(
        ReviewCommentModerationStatus.PENDING,
      );

      const quotesResponse = await gqlRequest(
        QUOTES_FOR_SERVICE_REQUEST_QUERY,
        { serviceRequestId },
        customerToken,
      ).expect(200);
      const quotesBody = quotesResponse.body as {
        data: {
          quotesForServiceRequest: {
            professionalProfile: { averageRating: number; reviewCount: number };
          }[];
        };
      };
      expect(
        quotesBody.data.quotesForServiceRequest[0].professionalProfile,
      ).toMatchObject({ averageRating: 5, reviewCount: 1 });
    });

    it('CustomerProfile.averageRating/.reviewCount update immediately too, from ratings the Customer RECEIVES (mirror of the Professional side)', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedCompletedEngagement();

      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 4, comment: null },
        professionalToken,
      ).expect(200);

      const myProfileResponse = await gqlRequest(
        MY_CUSTOMER_PROFILE_RATING_QUERY,
        {},
        customerToken,
      ).expect(200);
      const myProfileBody = myProfileResponse.body as {
        data: {
          myCustomerProfile: { averageRating: number; reviewCount: number };
        };
      };
      expect(myProfileBody.data.myCustomerProfile).toMatchObject({
        averageRating: 4,
        reviewCount: 1,
      });
    });
  });

  describe('myReceivedReviews', () => {
    it('omits the entire review (not just the comment) until the double-blind resolves', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedCompletedEngagement();

      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 4, comment: null },
        professionalToken,
      ).expect(200);

      // The Customer has NOT rated yet, and the Engagement just completed —
      // double-blind unresolved: the professional's review about them stays
      // invisible.
      const response = await gqlRequest(
        MY_RECEIVED_REVIEWS_QUERY,
        {},
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: { myReceivedReviews: { engagementId: string }[] };
      };
      expect(
        body.data.myReceivedReviews.some(
          (r) => r.engagementId === engagementId,
        ),
      ).toBe(false);
    });

    it('reveals both received reviews once BOTH parties have rated', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedCompletedEngagement();

      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        customerToken,
      ).expect(200);
      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 4, comment: null },
        professionalToken,
      ).expect(200);

      const customerReceived = await gqlRequest(
        MY_RECEIVED_REVIEWS_QUERY,
        {},
        customerToken,
      ).expect(200);
      const customerBody = customerReceived.body as {
        data: {
          myReceivedReviews: {
            engagementId: string;
            rating: number;
            authorRole: string;
          }[];
        };
      };
      const customerReceivedRow = customerBody.data.myReceivedReviews.find(
        (r) => r.engagementId === engagementId,
      );
      expect(customerReceivedRow).toMatchObject({
        rating: 4,
        authorRole: 'PROFESSIONAL',
      });

      const professionalReceived = await gqlRequest(
        MY_RECEIVED_REVIEWS_QUERY,
        {},
        professionalToken,
      ).expect(200);
      const professionalBody = professionalReceived.body as {
        data: {
          myReceivedReviews: {
            engagementId: string;
            rating: number;
            authorRole: string;
          }[];
        };
      };
      const professionalReceivedRow =
        professionalBody.data.myReceivedReviews.find(
          (r) => r.engagementId === engagementId,
        );
      expect(professionalReceivedRow).toMatchObject({
        rating: 5,
        authorRole: 'CUSTOMER',
      });
    });

    it('rating is always visible once resolved; comment renders null unless APPROVED', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedCompletedEngagement();

      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        customerToken,
      ).expect(200);
      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 4, comment: 'Buen cliente' },
        professionalToken,
      ).expect(200);
      // Still PENDING — not driven through the admin mutation here (see
      // admin-reviews.e2e-spec.ts for that flow).

      const response = await gqlRequest(
        MY_RECEIVED_REVIEWS_QUERY,
        {},
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: {
          myReceivedReviews: {
            engagementId: string;
            rating: number;
            comment: string | null;
          }[];
        };
      };
      const received = body.data.myReceivedReviews.find(
        (r) => r.engagementId === engagementId,
      );
      expect(received).toMatchObject({ rating: 4, comment: null });

      // Now approve it directly (admin flow re-tested end-to-end in
      // admin-reviews.e2e-spec.ts) and confirm it becomes visible.
      await prisma.review.updateMany({
        where: { engagementId, authorRole: 'PROFESSIONAL' },
        data: {
          commentModerationStatus: ReviewCommentModerationStatus.APPROVED,
        },
      });

      const afterApproval = await gqlRequest(
        MY_RECEIVED_REVIEWS_QUERY,
        {},
        customerToken,
      ).expect(200);
      const afterApprovalBody = afterApproval.body as {
        data: {
          myReceivedReviews: { engagementId: string; comment: string | null }[];
        };
      };
      const approvedRow = afterApprovalBody.data.myReceivedReviews.find(
        (r) => r.engagementId === engagementId,
      );
      expect(approvedRow?.comment).toBe('Buen cliente');
    });

    it('rejects an unauthenticated call with UNAUTHENTICATED', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: MY_RECEIVED_REVIEWS_QUERY })
        .expect(200);

      expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
    });

    it('is NOT gated by reviews.rating.enabled — still readable while the flag is off', async () => {
      const { engagementId, customerToken, professionalToken } =
        await seedCompletedEngagement();
      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 5, comment: null },
        customerToken,
      ).expect(200);
      await gqlRequest(
        SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
        { engagementId, rating: 4, comment: null },
        professionalToken,
      ).expect(200);

      await ensurePlatformSetting('reviews.rating.enabled', 'false');

      const response = await gqlRequest(
        MY_RECEIVED_REVIEWS_QUERY,
        {},
        customerToken,
      ).expect(200);
      const body = response.body as {
        data: { myReceivedReviews: { engagementId: string }[] } | null;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
      expect(
        body.data?.myReceivedReviews.some(
          (r) => r.engagementId === engagementId,
        ),
      ).toBe(true);
    });
  });
});
