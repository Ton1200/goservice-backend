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

const SEND_ENGAGEMENT_MESSAGE_MUTATION = `
  mutation SendEngagementMessage($engagementId: ID!, $input: SendEngagementMessageInput!) {
    sendEngagementMessage(engagementId: $engagementId, input: $input) {
      id conversationId senderRole content createdAt
    }
  }
`;

const ENGAGEMENT_MESSAGES_QUERY = `
  query EngagementMessages($engagementId: ID!) {
    engagementMessages(engagementId: $engagementId) {
      id senderRole content createdAt
    }
  }
`;

const ADMIN_ENGAGEMENT_CHAT_THREAD_QUERY = `
  query AdminEngagementChatThread($engagementId: ID!) {
    adminEngagementChatThread(engagementId: $engagementId) {
      id senderRole content createdAt
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for GOS-46 — Chat de Coordinación
 * (`sendEngagementMessage`/`engagementMessages`, plus the admin
 * `adminEngagementChatThread` audit query). Same "ad hoc seedX() helper, no
 * shared factory library" convention every other e2e spec in this suite
 * uses — closest sibling is `test/quotes.e2e-spec.ts` (Engagement fixture
 * setup: publish -> submit -> accept) plus `test/admin-quotes.e2e-spec.ts`
 * (admin login/permission-seeding helpers).
 *
 * Deliberately the first e2e suite for a "thread hung off a parent entity"
 * capability in this codebase — `quote-negotiation/` shipped with unit
 * tests only (see `graphql-contract.md`'s own documented gap) — because this
 * capability's core mechanic (idempotent Conversation creation via a DB
 * upsert) is a genuine persistence-level guarantee a mocked repository
 * cannot actually prove.
 */
describe('GraphQL Engagement Chat (GOS-46, e2e)', () => {
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
    const email = uniqueEmail('engagement-chat');
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
   * `quotes.e2e-spec.ts`) so this suite gets a real `Engagement` — not a
   * hand-inserted row — the same way an Engagement would actually come to
   * exist in production.
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

  it('sendEngagementMessage creates the Conversation transparently on the first message — no prior Conversation exists, no error', async () => {
    const { engagementId, customerToken } = await seedEngagement();

    const response = await gqlRequest(
      SEND_ENGAGEMENT_MESSAGE_MUTATION,
      { engagementId, input: { content: '¿A qué hora te viene bien mañana?' } },
      customerToken,
    ).expect(200);
    const body = response.body as {
      data: {
        sendEngagementMessage: {
          id: string;
          conversationId: string;
          senderRole: string;
          content: string;
        };
      } | null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data?.sendEngagementMessage).toMatchObject({
      senderRole: 'CUSTOMER',
      content: '¿A qué hora te viene bien mañana?',
    });

    const conversations = await prisma.engagementChatConversation.findMany({
      where: { engagementId },
    });
    expect(conversations).toHaveLength(1);
  });

  it('a second message from the OTHER party reuses the existing Conversation — no duplicate Conversation row is ever created', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedEngagement();

    await gqlRequest(
      SEND_ENGAGEMENT_MESSAGE_MUTATION,
      { engagementId, input: { content: 'Hola, ¿cuándo podés pasar?' } },
      customerToken,
    ).expect(200);

    const secondResponse = await gqlRequest(
      SEND_ENGAGEMENT_MESSAGE_MUTATION,
      { engagementId, input: { content: 'Mañana a las 9hs, ¿te sirve?' } },
      professionalToken,
    ).expect(200);
    const secondBody = secondResponse.body as {
      data: {
        sendEngagementMessage: { senderRole: string; conversationId: string };
      };
    };
    expect(secondBody.data.sendEngagementMessage.senderRole).toBe(
      'PROFESSIONAL',
    );

    const conversations = await prisma.engagementChatConversation.findMany({
      where: { engagementId },
    });
    expect(conversations).toHaveLength(1);

    const messagesResponse = await gqlRequest(
      ENGAGEMENT_MESSAGES_QUERY,
      { engagementId },
      customerToken,
    ).expect(200);
    const messagesBody = messagesResponse.body as {
      data: { engagementMessages: { senderRole: string; content: string }[] };
    };
    expect(messagesBody.data.engagementMessages).toHaveLength(2);
    expect(messagesBody.data.engagementMessages[0]).toMatchObject({
      senderRole: 'CUSTOMER',
      content: 'Hola, ¿cuándo podés pasar?',
    });
    expect(messagesBody.data.engagementMessages[1]).toMatchObject({
      senderRole: 'PROFESSIONAL',
      content: 'Mañana a las 9hs, ¿te sirve?',
    });
  });

  it('a third party (neither the CustomerProfile nor the ProfessionalProfile on this Engagement) is rejected from sending — ENGAGEMENT_NOT_FOUND', async () => {
    const { engagementId } = await seedEngagement();
    const thirdParty = await seedApprovedCustomer();
    const thirdPartyToken = await loginSessionToken(thirdParty.email);

    const response = await gqlRequest(
      SEND_ENGAGEMENT_MESSAGE_MUTATION,
      { engagementId, input: { content: 'Intento no autorizado.' } },
      thirdPartyToken,
    ).expect(200);
    const body = response.body as {
      data: null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ENGAGEMENT_NOT_FOUND');
  });

  it('a third party is also rejected from reading — ENGAGEMENT_NOT_FOUND', async () => {
    const { engagementId, customerToken } = await seedEngagement();
    await gqlRequest(
      SEND_ENGAGEMENT_MESSAGE_MUTATION,
      { engagementId, input: { content: 'Mensaje legítimo.' } },
      customerToken,
    ).expect(200);

    const thirdParty = await seedApprovedCustomer();
    const thirdPartyToken = await loginSessionToken(thirdParty.email);

    const response = await gqlRequest(
      ENGAGEMENT_MESSAGES_QUERY,
      { engagementId },
      thirdPartyToken,
    ).expect(200);
    const body = response.body as {
      data: null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ENGAGEMENT_NOT_FOUND');
  });

  it('an admin WITH ENGAGEMENT_CHAT_READ can read the full coordination thread', async () => {
    const { engagementId, customerToken, professionalToken } =
      await seedEngagement();
    await gqlRequest(
      SEND_ENGAGEMENT_MESSAGE_MUTATION,
      { engagementId, input: { content: 'Mensaje del cliente.' } },
      customerToken,
    ).expect(200);
    await gqlRequest(
      SEND_ENGAGEMENT_MESSAGE_MUTATION,
      { engagementId, input: { content: 'Respuesta del profesional.' } },
      professionalToken,
    ).expect(200);

    const admin = await seedAdminWithRole('ENGAGEMENT_CHAT_AUDITOR', [
      Permission.ENGAGEMENT_CHAT_READ,
    ]);
    const adminToken = await adminLoginToken(admin.email);

    const response = await adminGraphqlRequest(
      adminToken,
      ADMIN_ENGAGEMENT_CHAT_THREAD_QUERY,
      { engagementId },
    ).expect(200);
    const body = response.body as {
      data: {
        adminEngagementChatThread: { senderRole: string; content: string }[];
      };
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.adminEngagementChatThread).toHaveLength(2);
    expect(body.data.adminEngagementChatThread[0]).toMatchObject({
      senderRole: 'CUSTOMER',
      content: 'Mensaje del cliente.',
    });
  });

  it('an admin WITHOUT ENGAGEMENT_CHAT_READ is rejected — ADMIN_FORBIDDEN', async () => {
    const { engagementId } = await seedEngagement();
    const admin = await seedAdminWithRole('ENGAGEMENT_CHAT_NO_PERMS', []);
    const adminToken = await adminLoginToken(admin.email);

    const response = await adminGraphqlRequest(
      adminToken,
      ADMIN_ENGAGEMENT_CHAT_THREAD_QUERY,
      { engagementId },
    ).expect(200);
    const body = response.body as {
      data: null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
  });
});
