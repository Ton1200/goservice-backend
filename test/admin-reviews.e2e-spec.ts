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
  cleanProfilesData,
  cleanQuotesAndEngagementsData,
  cleanReviewsData,
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

const SUBMIT_ENGAGEMENT_REVIEW_MUTATION = `
  mutation SubmitEngagementReview($engagementId: ID!, $rating: Int!, $comment: String) {
    submitEngagementReview(engagementId: $engagementId, rating: $rating, comment: $comment) {
      id
    }
  }
`;

const ADMIN_REVIEW_FIELDS = `
  id engagementId authorRole rating comment commentModerationStatus moderatedByAdminUserId moderatedAt createdAt
`;

const ADMIN_REVIEWS_QUERY = `
  query AdminReviews($filter: AdminReviewsFilterInput, $limit: Int, $offset: Int) {
    adminReviews(filter: $filter, limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items { ${ADMIN_REVIEW_FIELDS} }
    }
  }
`;

const MODERATE_ENGAGEMENT_REVIEW_COMMENT_MUTATION = `
  mutation ModerateEngagementReviewComment($reviewId: ID!, $decision: ReviewModerationDecision!) {
    moderateEngagementReviewComment(reviewId: $reviewId, decision: $decision) {
      ${ADMIN_REVIEW_FIELDS}
    }
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

function errorCode(body: unknown): string | undefined {
  return (body as { errors?: GraphQLErrorEntry[] }).errors?.[0]?.extensions
    ?.code;
}

/**
 * e2e coverage for GOS-121's admin surface — `adminReviews`/
 * `moderateEngagementReviewComment` (`src/platform-admin/reviews/`):
 * `REVIEWS_READ`/`REVIEWS_WRITE` enforcement, the filter argument, and the
 * full approve/reject moderation flow (including that a REJECTED comment
 * stays visible to the admin but never to the counterparty — covered
 * jointly with `reviews.e2e-spec.ts`, which proves the counterparty side).
 */
describe('GraphQL /admin/graphql — adminReviews/moderateEngagementReviewComment (GOS-121, e2e)', () => {
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
    await cleanReviewsData(prisma);
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
    const email = uniqueEmail('admin-review');
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

  /** Full ServiceRequest -> Quote -> accept -> work -> COMPLETED flow, then
   * both parties submit a review (Professional's carries a comment, so it
   * has something to moderate). Returns the Professional's review id. */
  async function seedCompletedEngagementWithPendingComment(): Promise<{
    reviewId: string;
    engagementId: string;
  }> {
    const categoryId = await seedCategory();
    const customer = await seedApprovedCustomer();
    const professional = await seedApprovedProfessional([categoryId]);
    const customerToken = await loginConsumerSessionToken(customer.email);
    const professionalToken = await loginConsumerSessionToken(
      professional.email,
    );

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
    await consumerRequest(
      MARK_ENGAGEMENT_WORK_FINISHED_MUTATION,
      { engagementId },
      professionalToken,
    ).expect(200);
    await consumerRequest(
      CONFIRM_ENGAGEMENT_COMPLETION_MUTATION,
      { engagementId },
      customerToken,
    ).expect(200);

    await consumerRequest(
      SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
      { engagementId, rating: 5, comment: null },
      customerToken,
    ).expect(200);
    const professionalReview = await consumerRequest(
      SUBMIT_ENGAGEMENT_REVIEW_MUTATION,
      { engagementId, rating: 4, comment: 'Excelente cliente, muy claro.' },
      professionalToken,
    ).expect(200);
    const reviewId = (
      professionalReview.body as {
        data: { submitEngagementReview: { id: string } };
      }
    ).data.submitEngagementReview.id;

    return { reviewId, engagementId };
  }

  describe('adminReviews', () => {
    it('lists every Review, including PENDING comments, gated by REVIEWS_READ', async () => {
      const { reviewId } = await seedCompletedEngagementWithPendingComment();
      const admin = await seedAdminWithRole('reviews-reader', [
        Permission.REVIEWS_READ,
      ]);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(token, ADMIN_REVIEWS_QUERY, {
        filter: { commentModerationStatus: 'PENDING' },
      }).expect(200);
      const body = response.body as {
        data: {
          adminReviews: {
            items: { id: string; commentModerationStatus: string }[];
          };
        };
      };

      expect(body.data.adminReviews.items.some((r) => r.id === reviewId)).toBe(
        true,
      );
      expect(
        body.data.adminReviews.items.every(
          (r) => r.commentModerationStatus === 'PENDING',
        ),
      ).toBe(true);
    });

    it('rejects an admin without REVIEWS_READ with ADMIN_FORBIDDEN', async () => {
      await seedCompletedEngagementWithPendingComment();
      const admin = await seedAdminWithRole('reviews-none', []);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(
        token,
        ADMIN_REVIEWS_QUERY,
        {},
      ).expect(200);

      expect(errorCode(response.body)).toBe('ADMIN_FORBIDDEN');
    });
  });

  describe('moderateEngagementReviewComment', () => {
    it('approves a PENDING comment', async () => {
      const { reviewId } = await seedCompletedEngagementWithPendingComment();
      const admin = await seedAdminWithRole('reviews-writer-approve', [
        Permission.REVIEWS_WRITE,
      ]);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(
        token,
        MODERATE_ENGAGEMENT_REVIEW_COMMENT_MUTATION,
        { reviewId, decision: 'APPROVE' },
      ).expect(200);
      const body = response.body as {
        data: {
          moderateEngagementReviewComment: {
            commentModerationStatus: string;
            moderatedByAdminUserId: string;
            comment: string;
          };
        } | null;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data?.moderateEngagementReviewComment).toMatchObject({
        commentModerationStatus: 'APPROVED',
        comment: 'Excelente cliente, muy claro.',
      });

      const row = await prisma.review.findUnique({ where: { id: reviewId } });
      expect(row?.commentModerationStatus).toBe('APPROVED');
      expect(row?.moderatedAt).not.toBeNull();

      const auditLog = await prisma.adminAuditLog.findFirst({
        where: { targetType: 'Review', targetKey: reviewId },
      });
      expect(auditLog?.action).toBe('REVIEW_COMMENT_APPROVED');
    });

    it('rejects a PENDING comment — stays visible to admin, never to the counterparty (see reviews.e2e-spec.ts)', async () => {
      const { reviewId } = await seedCompletedEngagementWithPendingComment();
      const admin = await seedAdminWithRole('reviews-writer-reject', [
        Permission.REVIEWS_WRITE,
      ]);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(
        token,
        MODERATE_ENGAGEMENT_REVIEW_COMMENT_MUTATION,
        { reviewId, decision: 'REJECT' },
      ).expect(200);
      const body = response.body as {
        data: {
          moderateEngagementReviewComment: { commentModerationStatus: string };
        } | null;
      };

      expect(
        body.data?.moderateEngagementReviewComment.commentModerationStatus,
      ).toBe('REJECTED');
    });

    it('rejects a nonexistent review with REVIEW_NOT_FOUND', async () => {
      const admin = await seedAdminWithRole('reviews-writer-notfound', [
        Permission.REVIEWS_WRITE,
      ]);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(
        token,
        MODERATE_ENGAGEMENT_REVIEW_COMMENT_MUTATION,
        {
          reviewId: '00000000-0000-0000-0000-000000000000',
          decision: 'APPROVE',
        },
      ).expect(200);

      expect(errorCode(response.body)).toBe('REVIEW_NOT_FOUND');
    });

    it('rejects moderating an already-moderated review with REVIEW_COMMENT_ALREADY_MODERATED — no un-approve/un-reject', async () => {
      const { reviewId } = await seedCompletedEngagementWithPendingComment();
      const admin = await seedAdminWithRole('reviews-writer-twice', [
        Permission.REVIEWS_WRITE,
      ]);
      const token = await loginAdminAndGetToken(admin.email);

      await adminGraphqlRequest(
        token,
        MODERATE_ENGAGEMENT_REVIEW_COMMENT_MUTATION,
        { reviewId, decision: 'APPROVE' },
      ).expect(200);

      const second = await adminGraphqlRequest(
        token,
        MODERATE_ENGAGEMENT_REVIEW_COMMENT_MUTATION,
        { reviewId, decision: 'REJECT' },
      ).expect(200);

      expect(errorCode(second.body)).toBe('REVIEW_COMMENT_ALREADY_MODERATED');
    });

    it('rejects an admin without REVIEWS_WRITE with ADMIN_FORBIDDEN', async () => {
      const { reviewId } = await seedCompletedEngagementWithPendingComment();
      const admin = await seedAdminWithRole('reviews-write-none', [
        Permission.REVIEWS_READ,
      ]);
      const token = await loginAdminAndGetToken(admin.email);

      const response = await adminGraphqlRequest(
        token,
        MODERATE_ENGAGEMENT_REVIEW_COMMENT_MUTATION,
        { reviewId, decision: 'APPROVE' },
      ).expect(200);

      expect(errorCode(response.body)).toBe('ADMIN_FORBIDDEN');
    });
  });
});
