import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const CATEGORIES_QUERY = `
  query Categories {
    categories { id name }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface LoginResponseBody {
  data: { login: { userId: string; sessionToken: string } } | null;
}

interface CategoriesResponseBody {
  data: { categories: { id: string; name: string }[] } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `profiles-cat-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * e2e coverage for the read-only `categories` query (GOS-14/GOS-28) —
 * requires an active session (no public/unauthenticated exception carved
 * out) and returns exactly the seeded catalog rows.
 */
describe('GraphQL categories (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
    await cleanUsersData(prisma);
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
    await app.close();
  });

  async function seedEmailVerifiedUser(): Promise<{ email: string }> {
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
    });
    await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
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
    const body = response.body as LoginResponseBody;
    return body.data!.login.sessionToken;
  }

  function categoriesRequest(sessionToken?: string) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query: CATEGORIES_QUERY });
    if (sessionToken) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req.expect(200);
  }

  it('returns exactly the seeded category rows for an authenticated user', async () => {
    const a = await prisma.category.create({
      data: { name: uniqueCategoryName('Categoria-A') },
    });
    const b = await prisma.category.create({
      data: { name: uniqueCategoryName('Categoria-B') },
    });
    createdCategoryIds.push(a.id, b.id);

    const { email } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);

    const response = await categoriesRequest(sessionToken);
    const body = response.body as CategoriesResponseBody;

    expect(body.errors).toBeUndefined();
    const returnedIds = body.data?.categories.map((c) => c.id) ?? [];
    expect(returnedIds).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it('without an Authorization header -> UNAUTHENTICATED', async () => {
    const response = await categoriesRequest();
    const body = response.body as CategoriesResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
