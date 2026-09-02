import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanProfilesData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const UPSERT_CUSTOMER_PROFILE_MUTATION = `
  mutation UpsertCustomerProfile($input: UpsertCustomerProfileInput!) {
    upsertCustomerProfile(input: $input) { id }
  }
`;

const UPSERT_PROFESSIONAL_PROFILE_MUTATION = `
  mutation UpsertProfessionalProfile($input: UpsertProfessionalProfileInput!) {
    upsertProfessionalProfile(input: $input) { id }
  }
`;

interface LoginResponseBody {
  data: { login: { userId: string; sessionToken: string } } | null;
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `profiles-status-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(): string {
  return `Status-Cat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const CUSTOMER_INPUT = {
  firstName: 'Jane',
  lastName: 'Doe',
  addressLine: 'Av. Siempreviva 742',
  city: 'CABA',
  province: 'Buenos Aires',
};

function professionalInput(categoryId: string): Record<string, unknown> {
  return {
    firstName: 'Juan',
    lastName: 'Perez',
    city: 'CABA',
    serviceAreaDescription: 'CABA y GBA Norte',
    bio: 'Trabajo en el rubro hace mas de una decada.',
    specializations: [
      {
        categoryId,
        role: 'PRIMARY',
        description: 'Electricista matriculado con 10 años de experiencia.',
        yearsOfExperience: 10,
      },
    ],
  };
}

/**
 * e2e coverage for the EMAIL_VERIFIED -> PENDING_APPROVAL accountStatus
 * transition's SYMMETRY across profile types (GOS-14/GOS-28 REVERSAL — this
 * transition used to be CustomerProfile-only; it now fires on creation of
 * EITHER CustomerProfile or ProfessionalProfile, whichever comes first —
 * see ProfilesRepository's own class doc comment). Single-profile-type
 * transition/idempotency coverage lives in
 * `profiles-customer-profile.e2e-spec.ts` and
 * `profiles-professional-profile.e2e-spec.ts`; this file specifically
 * covers the CROSS-profile-type ordering guarantee: whichever profile type
 * is created SECOND for the same user must never re-transition or revert
 * the status.
 */
describe('GraphQL accountStatus transition symmetry across profile types (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanProfilesData(prisma);
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

  async function seedEmailVerifiedUser(): Promise<{
    email: string;
    userId: string;
  }> {
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
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
    return { email, userId: user.id };
  }

  async function seedCategory(): Promise<string> {
    const category = await prisma.category.create({
      data: { name: uniqueCategoryName() },
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
    const body = response.body as LoginResponseBody;
    return body.data!.login.sessionToken;
  }

  function upsertCustomerProfileRequest(sessionToken: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: UPSERT_CUSTOMER_PROFILE_MUTATION,
        variables: { input: CUSTOMER_INPUT },
      })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
  }

  function upsertProfessionalProfileRequest(
    sessionToken: string,
    categoryId: string,
  ) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: UPSERT_PROFESSIONAL_PROFILE_MUTATION,
        variables: { input: professionalInput(categoryId) },
      })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
  }

  it('customer-then-professional: only the first (CustomerProfile) transitions; the second (ProfessionalProfile) is a safe no-op', async () => {
    const { email, userId } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);
    const categoryId = await seedCategory();

    const customerResponse = await upsertCustomerProfileRequest(sessionToken);
    expect(
      (customerResponse.body as { errors?: unknown }).errors,
    ).toBeUndefined();
    const afterCustomer = await prisma.user.findUnique({
      where: { id: userId },
    });
    expect(afterCustomer?.accountStatus).toBe(
      UserAccountStatus.PENDING_APPROVAL,
    );

    const professionalResponse = await upsertProfessionalProfileRequest(
      sessionToken,
      categoryId,
    );
    expect(
      (professionalResponse.body as { errors?: unknown }).errors,
    ).toBeUndefined();
    const afterProfessional = await prisma.user.findUnique({
      where: { id: userId },
    });
    expect(afterProfessional?.accountStatus).toBe(
      UserAccountStatus.PENDING_APPROVAL,
    );
  });

  it('professional-then-customer: only the first (ProfessionalProfile) transitions; the second (CustomerProfile) is a safe no-op', async () => {
    const { email, userId } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);
    const categoryId = await seedCategory();

    const professionalResponse = await upsertProfessionalProfileRequest(
      sessionToken,
      categoryId,
    );
    expect(
      (professionalResponse.body as { errors?: unknown }).errors,
    ).toBeUndefined();
    const afterProfessional = await prisma.user.findUnique({
      where: { id: userId },
    });
    expect(afterProfessional?.accountStatus).toBe(
      UserAccountStatus.PENDING_APPROVAL,
    );

    const customerResponse = await upsertCustomerProfileRequest(sessionToken);
    expect(
      (customerResponse.body as { errors?: unknown }).errors,
    ).toBeUndefined();
    const afterCustomer = await prisma.user.findUnique({
      where: { id: userId },
    });
    expect(afterCustomer?.accountStatus).toBe(
      UserAccountStatus.PENDING_APPROVAL,
    );
  });
});
