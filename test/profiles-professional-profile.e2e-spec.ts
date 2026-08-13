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

const MY_PROFESSIONAL_PROFILE_QUERY = `
  query MyProfessionalProfile {
    myProfessionalProfile {
      id displayName city country serviceAreaDescription bio
      verificationStatus photoUrl languages
      specializations { role description yearsOfExperience order category { id name } }
    }
  }
`;

const UPSERT_PROFESSIONAL_PROFILE_MUTATION = `
  mutation UpsertProfessionalProfile($input: UpsertProfessionalProfileInput!) {
    upsertProfessionalProfile(input: $input) {
      id displayName city country serviceAreaDescription bio
      verificationStatus photoUrl languages
      specializations { role description yearsOfExperience order category { id name } }
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface LoginResponseBody {
  data: { login: { userId: string; sessionToken: string } } | null;
}

interface SpecializationPayload {
  role: string;
  description: string;
  yearsOfExperience: number | null;
  order: number;
  category: { id: string; name: string };
}

interface ProfessionalProfilePayload {
  id: string;
  displayName: string;
  city: string;
  country: string;
  serviceAreaDescription: string;
  bio: string;
  verificationStatus: string;
  photoUrl: string | null;
  languages: string[];
  specializations: SpecializationPayload[];
}

interface MyProfessionalProfileResponseBody {
  data: { myProfessionalProfile: ProfessionalProfilePayload | null } | null;
  errors?: GraphQLErrorEntry[];
}

interface UpsertProfessionalProfileResponseBody {
  data: { upsertProfessionalProfile: ProfessionalProfilePayload } | null;
  errors?: GraphQLErrorEntry[];
}

const PASSWORD = 'super-secret-1';

function uniqueEmail(): string {
  return `profiles-pp-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function primarySpecialization(
  categoryId: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    categoryId,
    role: 'PRIMARY',
    description: 'Electricista matriculado con 10 años de experiencia.',
    yearsOfExperience: 10,
    ...overrides,
  };
}

function secondarySpecialization(
  categoryId: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    categoryId,
    role: 'SECONDARY',
    description: 'Tambien hago reparaciones basicas de plomeria.',
    yearsOfExperience: 2,
    ...overrides,
  };
}

/**
 * e2e coverage for `myProfessionalProfile`/`upsertProfessionalProfile`
 * (GOS-14/GOS-28, restructured to per-specialization data in a follow-up
 * pass) — SessionGuard requirement, idempotent upsert, verificationStatus
 * always UNVERIFIED and never accountStatus-mutating, full-replace
 * specialization-set semantics (including description/yearsOfExperience/
 * order per item, not just membership), exactly-one-PRIMARY validation,
 * and category validation (empty, duplicate, nonexistent). Categories are
 * seeded directly via `prisma.category.create` in this file (same pattern
 * the rest of this suite uses to seed `User` rows directly) —
 * `prisma/seed.ts` is the separate dev/local convenience path, not wired
 * into e2e setup.
 */
describe('GraphQL myProfessionalProfile / upsertProfessionalProfile (e2e)', () => {
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
        firstName: 'Juan',
        lastName: 'Perez',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    return { email, userId: user.id };
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

  // Pure DTO/domain-validation-rejection tests never successfully write
  // anything (a rejected request never reaches the DB), so they're safe to
  // share one authenticated session instead of each registering+logging in
  // its own user — `login` itself is throttled to 10/60s
  // (`src/auth/auth.resolver.ts`), and this file alone would otherwise
  // exceed that shared budget once combined with the rest of the e2e run.
  let sharedValidationSessionToken: string | undefined;
  async function getSharedValidationSessionToken(): Promise<string> {
    if (!sharedValidationSessionToken) {
      const { email } = await seedEmailVerifiedUser();
      sharedValidationSessionToken = await loginSessionToken(email);
    }
    return sharedValidationSessionToken;
  }

  function myProfessionalProfileRequest(sessionToken?: string) {
    const req = request(app.getHttpServer())
      .post('/graphql')
      .send({ query: MY_PROFESSIONAL_PROFILE_QUERY });
    if (sessionToken) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req.expect(200);
  }

  function upsertProfessionalProfileRequest(
    input: Record<string, unknown>,
    sessionToken?: string,
  ) {
    const req = request(app.getHttpServer()).post('/graphql').send({
      query: UPSERT_PROFESSIONAL_PROFILE_MUTATION,
      variables: { input },
    });
    if (sessionToken) {
      req.set('Authorization', `Bearer ${sessionToken}`);
    }
    return req;
  }

  function baseInput(
    specializations: Record<string, unknown>[],
  ): Record<string, unknown> {
    return {
      displayName: 'Juan Perez',
      specializations,
      city: 'CABA',
      serviceAreaDescription: 'CABA y GBA Norte',
      bio: 'Trabajo en el rubro hace mas de una decada.',
    };
  }

  it('returns null before any ProfessionalProfile has been created', async () => {
    const { email } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);

    const response = await myProfessionalProfileRequest(sessionToken);
    const body = response.body as MyProfessionalProfileResponseBody;

    expect(body.errors).toBeUndefined();
    expect(body.data?.myProfessionalProfile).toBeNull();
  });

  it(
    'creation sets verificationStatus UNVERIFIED and transitions ' +
      'accountStatus EMAIL_VERIFIED -> PENDING_APPROVAL (same rule ' +
      "CustomerProfile's flow shares — see ProfilesRepository)",
    async () => {
      const { email, userId } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);
      const [categoryId] = await seedCategories(1);

      const response = await upsertProfessionalProfileRequest(
        baseInput([primarySpecialization(categoryId)]),
        sessionToken,
      ).expect(200);
      const body = response.body as UpsertProfessionalProfileResponseBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.upsertProfessionalProfile.verificationStatus).toBe(
        'UNVERIFIED',
      );

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.accountStatus).toBe(UserAccountStatus.PENDING_APPROVAL);
    },
  );

  it(
    'a second call (edit) does not re-transition/revert accountStatus once ' +
      'already PENDING_APPROVAL',
    async () => {
      const { email, userId } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);
      const [categoryId] = await seedCategories(1);

      await upsertProfessionalProfileRequest(
        baseInput([primarySpecialization(categoryId)]),
        sessionToken,
      ).expect(200);
      const firstUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(firstUser?.accountStatus).toBe(UserAccountStatus.PENDING_APPROVAL);

      await upsertProfessionalProfileRequest(
        baseInput([
          primarySpecialization(categoryId, { description: 'Edit.' }),
        ]),
        sessionToken,
      ).expect(200);
      const secondUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(secondUser?.accountStatus).toBe(
        UserAccountStatus.PENDING_APPROVAL,
      );
    },
  );

  it(
    'creates a PRIMARY + multiple SECONDARY specializations, each with its ' +
      'own description/yearsOfExperience, in submission order',
    async () => {
      const { email } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);
      const [electricidad, plomeria, pintura] = await seedCategories(3);

      const response = await upsertProfessionalProfileRequest(
        baseInput([
          primarySpecialization(electricidad, {
            description: 'Electricista matriculado.',
            yearsOfExperience: 12,
          }),
          secondarySpecialization(plomeria, {
            description: 'Reparaciones basicas de plomeria.',
            yearsOfExperience: 2,
          }),
          secondarySpecialization(pintura, {
            description: 'Pintura de interiores.',
            yearsOfExperience: 1,
          }),
        ]),
        sessionToken,
      ).expect(200);
      const body = response.body as UpsertProfessionalProfileResponseBody;

      expect(body.data?.upsertProfessionalProfile.specializations).toEqual([
        expect.objectContaining({
          role: 'PRIMARY',
          description: 'Electricista matriculado.',
          yearsOfExperience: 12,
          order: 0,
          category: { id: electricidad, name: expect.any(String) as string },
        }),
        expect.objectContaining({
          role: 'SECONDARY',
          description: 'Reparaciones basicas de plomeria.',
          yearsOfExperience: 2,
          order: 1,
          category: { id: plomeria, name: expect.any(String) as string },
        }),
        expect.objectContaining({
          role: 'SECONDARY',
          description: 'Pintura de interiores.',
          yearsOfExperience: 1,
          order: 2,
          category: { id: pintura, name: expect.any(String) as string },
        }),
      ]);
    },
  );

  it('a repeat call with a different specialization set REPLACES, not appends', async () => {
    const { email, userId } = await seedEmailVerifiedUser();
    const sessionToken = await loginSessionToken(email);
    const [catA, catB, catC] = await seedCategories(3);

    await upsertProfessionalProfileRequest(
      baseInput([primarySpecialization(catA), secondarySpecialization(catB)]),
      sessionToken,
    ).expect(200);

    const profile1 = await prisma.professionalProfile.findUnique({
      where: { userId },
    });
    const rows1 = await prisma.professionalSpecialization.findMany({
      where: { professionalProfileId: profile1!.id },
    });
    expect(rows1).toHaveLength(2);

    const response2 = await upsertProfessionalProfileRequest(
      baseInput([primarySpecialization(catC)]),
      sessionToken,
    ).expect(200);
    const body2 = response2.body as UpsertProfessionalProfileResponseBody;

    expect(
      body2.data?.upsertProfessionalProfile.specializations.map(
        (s) => s.category.id,
      ),
    ).toEqual([catC]);

    const rows2 = await prisma.professionalSpecialization.findMany({
      where: { professionalProfileId: profile1!.id },
    });
    expect(rows2.map((r) => r.categoryId)).toEqual([catC]);

    const profileRows = await prisma.professionalProfile.findMany({
      where: { userId },
    });
    expect(profileRows).toHaveLength(1);
  });

  it('rejects an empty specializations list at the DTO validation layer', async () => {
    const sessionToken = await getSharedValidationSessionToken();

    const response = await upsertProfessionalProfileRequest(
      baseInput([]),
      sessionToken,
    );

    expect(response.body).toHaveProperty('errors');
  });

  it('rejects a specializations list containing a duplicate categoryId at the DTO validation layer', async () => {
    const sessionToken = await getSharedValidationSessionToken();
    const [categoryId] = await seedCategories(1);

    const response = await upsertProfessionalProfileRequest(
      baseInput([
        primarySpecialization(categoryId),
        secondarySpecialization(categoryId),
      ]),
      sessionToken,
    );

    expect(response.body).toHaveProperty('errors');
  });

  it('rejects a specialization missing description at the DTO validation layer (nested)', async () => {
    const sessionToken = await getSharedValidationSessionToken();
    const [categoryId] = await seedCategories(1);
    const { description, ...withoutDescription } =
      primarySpecialization(categoryId);
    void description;

    const response = await upsertProfessionalProfileRequest(
      baseInput([withoutDescription]),
      sessionToken,
    );

    expect(response.body).toHaveProperty('errors');
  });

  it('rejects a negative yearsOfExperience within a specialization at the DTO validation layer (nested)', async () => {
    const sessionToken = await getSharedValidationSessionToken();
    const [categoryId] = await seedCategories(1);

    const response = await upsertProfessionalProfileRequest(
      baseInput([primarySpecialization(categoryId, { yearsOfExperience: -1 })]),
      sessionToken,
    );

    expect(response.body).toHaveProperty('errors');
  });

  it(
    'rejects zero PRIMARY specializations with PRIMARY_SPECIALIZATION_REQUIRED, ' +
      'and creates no row',
    async () => {
      const { email, userId } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);
      const [categoryId] = await seedCategories(1);

      const response = await upsertProfessionalProfileRequest(
        baseInput([secondarySpecialization(categoryId)]),
        sessionToken,
      ).expect(200);
      const body = response.body as UpsertProfessionalProfileResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0]?.extensions?.code).toBe(
        'PRIMARY_SPECIALIZATION_REQUIRED',
      );

      const profile = await prisma.professionalProfile.findUnique({
        where: { userId },
      });
      expect(profile).toBeNull();
    },
  );

  it('rejects two PRIMARY specializations with PRIMARY_SPECIALIZATION_REQUIRED', async () => {
    const sessionToken = await getSharedValidationSessionToken();
    const [catA, catB] = await seedCategories(2);

    const response = await upsertProfessionalProfileRequest(
      baseInput([primarySpecialization(catA), primarySpecialization(catB)]),
      sessionToken,
    ).expect(200);
    const body = response.body as UpsertProfessionalProfileResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe(
      'PRIMARY_SPECIALIZATION_REQUIRED',
    );
  });

  it(
    'rejects a well-formed but nonexistent categoryId with ' +
      'CATEGORY_NOT_FOUND, and creates no row',
    async () => {
      const { email, userId } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);
      const [realCategoryId] = await seedCategories(1);
      const nonexistentId = '00000000-0000-4000-8000-000000000000';

      const response = await upsertProfessionalProfileRequest(
        baseInput([
          primarySpecialization(realCategoryId),
          secondarySpecialization(nonexistentId),
        ]),
        sessionToken,
      ).expect(200);
      const body = response.body as UpsertProfessionalProfileResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_NOT_FOUND');

      const profile = await prisma.professionalProfile.findUnique({
        where: { userId },
      });
      expect(profile).toBeNull();
    },
  );

  it('myProfessionalProfile without an Authorization header -> UNAUTHENTICATED', async () => {
    const response = await myProfessionalProfileRequest();
    const body = response.body as MyProfessionalProfileResponseBody;

    // myProfessionalProfile is a nullable field, so a field-level error
    // nulls just that field (not the whole `data` object) — standard
    // GraphQL null-propagation, unlike the non-null mutations tested
    // elsewhere in this file.
    expect(body.data?.myProfessionalProfile).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('upsertProfessionalProfile without an Authorization header -> UNAUTHENTICATED', async () => {
    const [categoryId] = await seedCategories(1);

    const response = await upsertProfessionalProfileRequest(
      baseInput([primarySpecialization(categoryId)]),
    ).expect(200);
    const body = response.body as UpsertProfessionalProfileResponseBody;

    expect(body.data).toBeNull();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it(
    'defaults languages to an empty list and leaves photoUrl null when ' +
      'omitted, then accepts and returns both unchanged once provided',
    async () => {
      const { email } = await seedEmailVerifiedUser();
      const sessionToken = await loginSessionToken(email);
      const [categoryId] = await seedCategories(1);

      const withoutThem = await upsertProfessionalProfileRequest(
        baseInput([primarySpecialization(categoryId)]),
        sessionToken,
      ).expect(200);
      const withoutThemBody =
        withoutThem.body as UpsertProfessionalProfileResponseBody;
      expect(
        withoutThemBody.data?.upsertProfessionalProfile.photoUrl,
      ).toBeNull();
      expect(withoutThemBody.data?.upsertProfessionalProfile.languages).toEqual(
        [],
      );

      const withThem = await upsertProfessionalProfileRequest(
        {
          ...baseInput([primarySpecialization(categoryId)]),
          photoUrl: 'https://cdn.example.com/pro.jpg',
          languages: ['es', 'en'],
        },
        sessionToken,
      ).expect(200);
      const withThemBody =
        withThem.body as UpsertProfessionalProfileResponseBody;
      expect(withThemBody.data?.upsertProfessionalProfile).toMatchObject({
        photoUrl: 'https://cdn.example.com/pro.jpg',
        languages: ['es', 'en'],
      });
    },
  );

  it('rejects a duplicate entry in languages at the DTO validation layer', async () => {
    const sessionToken = await getSharedValidationSessionToken();
    const [categoryId] = await seedCategories(1);

    const response = await upsertProfessionalProfileRequest(
      {
        ...baseInput([primarySpecialization(categoryId)]),
        languages: ['es', 'es'],
      },
      sessionToken,
    );

    expect(response.body).toHaveProperty('errors');
  });
});
