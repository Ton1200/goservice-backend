import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminUserStatus,
  AuthProvider,
  CountryCode,
  MediaUploadRefIntendedUse,
  Permission,
  ProfessionalVerificationStatus,
  SpecializationRole,
  UserAccountStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import sharp from 'sharp';
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
import { waitForUpload } from './support/wait-for-upload';

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
    acceptQuote(quoteId: $quoteId) { engagement { id status } }
  }
`;

const REQUEST_MEDIA_UPLOAD_URL_MUTATION = `
  mutation RequestMediaUploadUrl($input: RequestMediaUploadUrlInput!) {
    requestMediaUploadUrl(input: $input) { ref uploadUrl fileUrl expiresAt }
  }
`;

const ADD_QUOTE_ATTACHMENT_MUTATION = `
  mutation AddQuoteAttachment($quoteId: ID!, $input: AddQuoteAttachmentInput!) {
    addQuoteAttachment(quoteId: $quoteId, input: $input) {
      id status
      attachments { id url createdAt }
    }
  }
`;

const MY_QUOTES_QUERY = `
  query MyQuotes { myQuotes { id attachments { id url } } }
`;

const POST_NEGOTIATION_MESSAGE_MUTATION = `
  mutation PostQuoteNegotiationMessage($quoteId: ID!, $input: PostQuoteNegotiationMessageInput!) {
    postQuoteNegotiationMessage(quoteId: $quoteId, input: $input) {
      id message imageUrl
    }
  }
`;

const NEGOTIATION_MESSAGES_QUERY = `
  query QuoteNegotiationMessages($quoteId: ID!) {
    quoteNegotiationMessages(quoteId: $quoteId) { id message imageUrl }
  }
`;

const SEND_ENGAGEMENT_MESSAGE_MUTATION = `
  mutation SendEngagementMessage($engagementId: ID!, $input: SendEngagementMessageInput!) {
    sendEngagementMessage(engagementId: $engagementId, input: $input) {
      id content imageUrl
    }
  }
`;

const ENGAGEMENT_MESSAGES_QUERY = `
  query EngagementMessages($engagementId: ID!) {
    engagementMessages(engagementId: $engagementId) { id content imageUrl }
  }
`;

const ADMIN_QUOTE_DETAIL_QUERY = `
  query QuoteDetail($id: ID!) {
    quoteDetail(id: $id) { id attachments { id url createdAt } }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(label = 'gos72'): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makePngBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 20, g: 140, b: 90 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * GOS-72 e2e — reference images on a Quote (`addQuoteAttachment`) and one
 * optional image per Quote-negotiation / Engagement-chat message, all backed
 * by the shared `requestMediaUploadUrl` + `MediaUploadRef` seam and the
 * GOS-70 async WebP pipeline. Also asserts the single-use / expiry /
 * wrong-`intendedUse` rejections and the admin `quoteDetail` visibility.
 * Same ad-hoc `seedX()` convention as `quotes.e2e-spec.ts` /
 * `engagement-chat.e2e-spec.ts`.
 */
describe('GraphQL GOS-72 — Quote attachments + message images (e2e)', () => {
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

  async function seedUser(): Promise<{ email: string; userId: string }> {
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
        accountStatus: UserAccountStatus.APPROVED,
      },
    });
    return { email, userId: user.id };
  }

  async function seedApprovedCustomer() {
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
    return { email, userId, customerProfileId: customerProfile.id };
  }

  async function seedApprovedProfessional(categoryIds: string[]) {
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
    return { email, userId, professionalProfileId: professionalProfile.id };
  }

  async function seedCategory(): Promise<string> {
    const category = await prisma.category.create({
      data: { name: uniqueName('Categoria') },
    });
    createdCategoryIds.push(category.id);
    return category.id;
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

  /** ServiceRequest -> Quote(SENT). Does NOT accept the quote. */
  async function seedSentQuote(): Promise<{
    quoteId: string;
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

    return { quoteId, customerToken, professionalToken };
  }

  async function seedEngagement(): Promise<{
    engagementId: string;
    customerToken: string;
    professionalToken: string;
  }> {
    const { quoteId, customerToken, professionalToken } = await seedSentQuote();
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

  async function requestMediaUpload(
    token: string,
    intendedUse: MediaUploadRefIntendedUse,
  ): Promise<{ ref: string; uploadUrl: string; fileUrl: string }> {
    const response = await gqlRequest(
      REQUEST_MEDIA_UPLOAD_URL_MUTATION,
      {
        input: { intendedUse, fileName: 'foto.png', contentType: 'image/png' },
      },
      token,
    ).expect(200);
    const body = response.body as {
      data: {
        requestMediaUploadUrl: {
          ref: string;
          uploadUrl: string;
          fileUrl: string;
        };
      } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(body.errors).toBeUndefined();
    return body.data!.requestMediaUploadUrl;
  }

  async function putImage(uploadUrl: string): Promise<void> {
    const bytes = await makePngBytes();
    await request(app.getHttpServer())
      .put(uploadUrl.replace(/^https?:\/\/[^/]+/, ''))
      .set('Content-Type', 'image/png')
      .send(bytes)
      .expect(200);
  }

  it('attaches MULTIPLE reference images to a Quote, stored as processed WebP, visible on myQuotes and admin quoteDetail', async () => {
    const { quoteId, professionalToken } = await seedSentQuote();

    const a = await requestMediaUpload(
      professionalToken,
      MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
    );
    const b = await requestMediaUpload(
      professionalToken,
      MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
    );
    expect(a.fileUrl).toMatch(/\.webp$/);
    await putImage(a.uploadUrl);
    await putImage(b.uploadUrl);

    const addResponse = await gqlRequest(
      ADD_QUOTE_ATTACHMENT_MUTATION,
      { quoteId, input: { mediaUploadRefIds: [a.ref, b.ref] } },
      professionalToken,
    ).expect(200);
    const addBody = addResponse.body as {
      data: {
        addQuoteAttachment: {
          id: string;
          attachments: { id: string; url: string }[];
        };
      } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(addBody.errors).toBeUndefined();
    expect(
      addBody.data!.addQuoteAttachment.attachments.map((x) => x.url),
    ).toEqual([a.fileUrl, b.fileUrl]);

    // The bytes are really fetchable as WebP once the worker runs.
    const getResponse = await waitForUpload(
      app.getHttpServer(),
      a.fileUrl.replace(/^https?:\/\/[^/]+/, ''),
    );
    expect(getResponse.headers['content-type']).toContain('image/webp');

    const myQuotes = await gqlRequest(
      MY_QUOTES_QUERY,
      {},
      professionalToken,
    ).expect(200);
    const myQuotesBody = myQuotes.body as {
      data: { myQuotes: { id: string; attachments: { url: string }[] }[] };
    };
    const mine = myQuotesBody.data.myQuotes.find((q) => q.id === quoteId)!;
    expect(mine.attachments).toHaveLength(2);

    // Admin with QUOTES_READ sees the same attachments on quoteDetail.
    const admin = await seedAdminWithRole('E2E_QUOTES_READER', [
      Permission.QUOTES_READ,
    ]);
    const adminToken = await adminLoginToken(admin.email);
    const detail = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: ADMIN_QUOTE_DETAIL_QUERY, variables: { id: quoteId } })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const detailBody = detail.body as {
      data: { quoteDetail: { attachments: { url: string }[] } } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(detailBody.errors).toBeUndefined();
    expect(detailBody.data!.quoteDetail.attachments.map((x) => x.url)).toEqual([
      a.fileUrl,
      b.fileUrl,
    ]);
  });

  it('attaches an image to a Quote-negotiation message', async () => {
    const { quoteId, professionalToken } = await seedSentQuote();
    const ref = await requestMediaUpload(
      professionalToken,
      MediaUploadRefIntendedUse.QUOTE_NEGOTIATION_MESSAGE_IMAGE,
    );
    await putImage(ref.uploadUrl);

    const post = await gqlRequest(
      POST_NEGOTIATION_MESSAGE_MUTATION,
      {
        quoteId,
        input: { message: 'Mirá esta referencia', mediaUploadRefId: ref.ref },
      },
      professionalToken,
    ).expect(200);
    const postBody = post.body as {
      data: { postQuoteNegotiationMessage: { imageUrl: string | null } } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(postBody.errors).toBeUndefined();
    expect(postBody.data!.postQuoteNegotiationMessage.imageUrl).toBe(
      ref.fileUrl,
    );

    const list = await gqlRequest(
      NEGOTIATION_MESSAGES_QUERY,
      { quoteId },
      professionalToken,
    ).expect(200);
    const listBody = list.body as {
      data: { quoteNegotiationMessages: { imageUrl: string | null }[] };
    };
    expect(listBody.data.quoteNegotiationMessages[0].imageUrl).toBe(
      ref.fileUrl,
    );
  });

  it('attaches an image to an Engagement-chat message', async () => {
    const { engagementId, customerToken } = await seedEngagement();
    const ref = await requestMediaUpload(
      customerToken,
      MediaUploadRefIntendedUse.ENGAGEMENT_CHAT_MESSAGE_IMAGE,
    );
    await putImage(ref.uploadUrl);

    const send = await gqlRequest(
      SEND_ENGAGEMENT_MESSAGE_MUTATION,
      {
        engagementId,
        input: { content: 'Así quedó el acceso', mediaUploadRefId: ref.ref },
      },
      customerToken,
    ).expect(200);
    const sendBody = send.body as {
      data: { sendEngagementMessage: { imageUrl: string | null } } | null;
      errors?: GraphQLErrorEntry[];
    };
    expect(sendBody.errors).toBeUndefined();
    expect(sendBody.data!.sendEngagementMessage.imageUrl).toBe(ref.fileUrl);

    const list = await gqlRequest(
      ENGAGEMENT_MESSAGES_QUERY,
      { engagementId },
      customerToken,
    ).expect(200);
    const listBody = list.body as {
      data: { engagementMessages: { imageUrl: string | null }[] };
    };
    expect(listBody.data.engagementMessages[0].imageUrl).toBe(ref.fileUrl);
  });

  it('rejects a MediaUploadRef that was already CONSUMED (single-use)', async () => {
    const { quoteId, professionalToken } = await seedSentQuote();
    const ref = await requestMediaUpload(
      professionalToken,
      MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
    );
    await putImage(ref.uploadUrl);

    await gqlRequest(
      ADD_QUOTE_ATTACHMENT_MUTATION,
      { quoteId, input: { mediaUploadRefIds: [ref.ref] } },
      professionalToken,
    ).expect(200);

    const second = await gqlRequest(
      ADD_QUOTE_ATTACHMENT_MUTATION,
      { quoteId, input: { mediaUploadRefIds: [ref.ref] } },
      professionalToken,
    ).expect(200);
    const secondBody = second.body as { errors?: GraphQLErrorEntry[] };
    expect(secondBody.errors?.[0].extensions?.code).toBe(
      'INVALID_MEDIA_UPLOAD_REF',
    );
  });

  it('rejects an EXPIRED MediaUploadRef', async () => {
    const { quoteId, professionalToken } = await seedSentQuote();
    const professionalUser = await prisma.professionalProfile.findFirstOrThrow({
      where: { quotes: { some: { id: quoteId } } },
      select: { userId: true },
    });
    const expiredRef = await prisma.mediaUploadRef.create({
      data: {
        userId: professionalUser.userId,
        storageKey: 'deadbeefdeadbeefdeadbeefdeadbeef.webp',
        fileUrl: 'http://localhost:3000/uploads/deadbeef.webp',
        intendedUse: MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await gqlRequest(
      ADD_QUOTE_ATTACHMENT_MUTATION,
      { quoteId, input: { mediaUploadRefIds: [expiredRef.id] } },
      professionalToken,
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };
    expect(body.errors?.[0].extensions?.code).toBe('INVALID_MEDIA_UPLOAD_REF');
  });

  it('rejects a MediaUploadRef requested for a DIFFERENT intendedUse (cross-use)', async () => {
    const { quoteId, professionalToken } = await seedSentQuote();
    const ref = await requestMediaUpload(
      professionalToken,
      MediaUploadRefIntendedUse.ENGAGEMENT_CHAT_MESSAGE_IMAGE,
    );
    await putImage(ref.uploadUrl);

    const response = await gqlRequest(
      ADD_QUOTE_ATTACHMENT_MUTATION,
      { quoteId, input: { mediaUploadRefIds: [ref.ref] } },
      professionalToken,
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };
    expect(body.errors?.[0].extensions?.code).toBe('INVALID_MEDIA_UPLOAD_REF');
  });

  it('a different Professional cannot attach images to a Quote that is not theirs (QUOTE_NOT_FOUND)', async () => {
    const { quoteId } = await seedSentQuote();
    const categoryId = await seedCategory();
    const other = await seedApprovedProfessional([categoryId]);
    const otherToken = await loginSessionToken(other.email);
    const ref = await requestMediaUpload(
      otherToken,
      MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
    );
    await putImage(ref.uploadUrl);

    const response = await gqlRequest(
      ADD_QUOTE_ATTACHMENT_MUTATION,
      { quoteId, input: { mediaUploadRefIds: [ref.ref] } },
      otherToken,
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };
    expect(body.errors?.[0].extensions?.code).toBe('QUOTE_NOT_FOUND');
  });
});
