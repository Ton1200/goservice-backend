import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminUserStatus,
  AuthProvider,
  CountryCode,
  Permission,
  ProfessionalVerificationStatus,
  ServiceRequestUrgency,
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
  cleanServiceRequestsData,
  cleanUsersData,
  createTestApp,
} from './support/test-app';

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

const CATEGORY_FIELDS = `id name displayOrder parentId`;

const ADMIN_CATEGORIES_QUERY = `
  query AdminCategories {
    adminCategories { ${CATEGORY_FIELDS} }
  }
`;

const ADMIN_CATEGORY_TREE_QUERY = `
  query AdminCategoryTree {
    adminCategoryTree { id name displayOrder parentId children { id name displayOrder parentId children { id } } }
  }
`;

const PUBLIC_CATEGORIES_QUERY = `
  query Categories {
    categories { ${CATEGORY_FIELDS} }
  }
`;

const CREATE_CATEGORY_MUTATION = `
  mutation CreateCategory($input: CreateCategoryInput!) {
    createCategory(input: $input) { ${CATEGORY_FIELDS} }
  }
`;

const UPDATE_CATEGORY_MUTATION = `
  mutation UpdateCategory($id: ID!, $input: UpdateCategoryInput!) {
    updateCategory(id: $id, input: $input) { ${CATEGORY_FIELDS} }
  }
`;

const DELETE_CATEGORY_MUTATION = `
  mutation DeleteCategory($id: ID!) {
    deleteCategory(id: $id) { success }
  }
`;

const PASSWORD = 'super-secret-1';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueCategoryName(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface CategoryPayload {
  id: string;
  name: string;
  displayOrder: number;
  parentId: string | null;
}

/**
 * e2e coverage for the Category catalog's full admin CRUD + hierarchy
 * (category-tree follow-up, 2026-08-18) — `adminCategories`/
 * `adminCategoryTree`/`createCategory`/`updateCategory`/`deleteCategory`,
 * `CATEGORIES_READ`/`CATEGORIES_WRITE` permission enforcement, cycle
 * prevention, the "in use" delete block, and the public schema's own
 * `categories` query respecting the same tree order.
 */
describe('GraphQL /admin/graphql — Category CRUD + hierarchy (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  // Same "flush the Redis-backed adminLogin/login throttle counter before
  // every test" convention every other admin-heavy e2e file in this repo
  // already establishes.
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
    token: string | undefined,
    query: string,
    variables?: unknown,
  ) {
    const req = request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query, variables });
    if (token) {
      req.set('Authorization', `Bearer ${token}`);
    }
    return req;
  }

  async function seedCategory(
    overrides?: Partial<{
      name: string;
      displayOrder: number;
      parentId: string;
    }>,
  ): Promise<CategoryPayload> {
    const category = await prisma.category.create({
      data: {
        name: overrides?.name ?? uniqueCategoryName('Categoria'),
        displayOrder: overrides?.displayOrder ?? 0,
        parentId: overrides?.parentId ?? null,
      },
    });
    createdCategoryIds.push(category.id);
    return category;
  }

  async function seedFullAdmin(): Promise<{ token: string }> {
    const { email } = await seedAdminWithRole('SUPER_ADMIN_CATEGORIES_E2E', [
      Permission.CATEGORIES_READ,
      Permission.CATEGORIES_WRITE,
    ]);
    return { token: await loginAdminAndGetToken(email) };
  }

  async function seedReadOnlyAdmin(): Promise<{ token: string }> {
    const { email } = await seedAdminWithRole('SUPPORT_VIEWER_CATEGORIES_E2E', [
      Permission.CATEGORIES_READ,
    ]);
    return { token: await loginAdminAndGetToken(email) };
  }

  // ---- read access ----------------------------------------------------

  it('adminCategories lists categories in tree pre-order (parent immediately followed by its children)', async () => {
    const { token } = await seedFullAdmin();
    const parent = await seedCategory({ name: uniqueCategoryName('Padre') });
    const child = await seedCategory({
      name: uniqueCategoryName('Hijo'),
      parentId: parent.id,
    });

    const response = await adminGraphqlRequest(
      token,
      ADMIN_CATEGORIES_QUERY,
    ).expect(200);
    const body = response.body as {
      data: { adminCategories: CategoryPayload[] };
    };
    const ids = body.data.adminCategories.map((c) => c.id);

    expect(ids.indexOf(parent.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(child.id)).toBe(ids.indexOf(parent.id) + 1);
  });

  it('adminCategoryTree nests a child under its parent', async () => {
    const { token } = await seedFullAdmin();
    const parent = await seedCategory({ name: uniqueCategoryName('Padre') });
    const child = await seedCategory({
      name: uniqueCategoryName('Hijo'),
      parentId: parent.id,
    });

    const response = await adminGraphqlRequest(
      token,
      ADMIN_CATEGORY_TREE_QUERY,
    ).expect(200);
    const body = response.body as {
      data: {
        adminCategoryTree: {
          id: string;
          children: { id: string }[];
        }[];
      };
    };

    const parentNode = body.data.adminCategoryTree.find(
      (node) => node.id === parent.id,
    );
    expect(parentNode).toBeDefined();
    expect(parentNode!.children.map((c) => c.id)).toContain(child.id);
  });

  it('a CATEGORIES_READ-only admin can list but cannot create (ADMIN_FORBIDDEN)', async () => {
    const { token } = await seedReadOnlyAdmin();

    await adminGraphqlRequest(token, ADMIN_CATEGORIES_QUERY).expect(200);

    const response = await adminGraphqlRequest(
      token,
      CREATE_CATEGORY_MUTATION,
      {
        input: { name: uniqueCategoryName('Nueva') },
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
  });

  it('an unauthenticated request is rejected with ADMIN_UNAUTHENTICATED', async () => {
    const response = await adminGraphqlRequest(
      undefined,
      ADMIN_CATEGORIES_QUERY,
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
  });

  // ---- createCategory ---------------------------------------------------

  it('createCategory creates a root Category and writes an AdminAuditLog row', async () => {
    const { token } = await seedFullAdmin();
    const name = uniqueCategoryName('Cerrajeria');

    const response = await adminGraphqlRequest(
      token,
      CREATE_CATEGORY_MUTATION,
      {
        input: { name },
      },
    ).expect(200);
    const body = response.body as { data: { createCategory: CategoryPayload } };
    createdCategoryIds.push(body.data.createCategory.id);

    expect(body.data.createCategory.name).toBe(name);
    expect(body.data.createCategory.parentId).toBeNull();

    const auditRow = await prisma.adminAuditLog.findFirst({
      where: {
        action: 'CATEGORY_CREATED',
        targetKey: body.data.createCategory.id,
      },
    });
    expect(auditRow).not.toBeNull();
  });

  it('createCategory creates a child Category under an existing parentId', async () => {
    const { token } = await seedFullAdmin();
    const parent = await seedCategory({ name: uniqueCategoryName('Padre') });

    const response = await adminGraphqlRequest(
      token,
      CREATE_CATEGORY_MUTATION,
      {
        input: { name: uniqueCategoryName('Hijo'), parentId: parent.id },
      },
    ).expect(200);
    const body = response.body as { data: { createCategory: CategoryPayload } };
    createdCategoryIds.push(body.data.createCategory.id);

    expect(body.data.createCategory.parentId).toBe(parent.id);
  });

  it('createCategory rejects a case-insensitive duplicate name (CATEGORY_NAME_TAKEN)', async () => {
    const { token } = await seedFullAdmin();
    const existing = await seedCategory({
      name: uniqueCategoryName('Plomeria'),
    });

    const response = await adminGraphqlRequest(
      token,
      CREATE_CATEGORY_MUTATION,
      {
        input: { name: existing.name.toUpperCase() },
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_NAME_TAKEN');
  });

  it('createCategory rejects a nonexistent parentId (CATEGORY_NOT_FOUND)', async () => {
    const { token } = await seedFullAdmin();

    const response = await adminGraphqlRequest(
      token,
      CREATE_CATEGORY_MUTATION,
      {
        input: {
          name: uniqueCategoryName('Huerfana'),
          parentId: '00000000-0000-0000-0000-000000000000',
        },
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_NOT_FOUND');
  });

  // ---- updateCategory -----------------------------------------------

  it('updateCategory renames/reorders a Category and writes an AdminAuditLog row', async () => {
    const { token } = await seedFullAdmin();
    const category = await seedCategory();
    const newName = uniqueCategoryName('Renombrada');

    const response = await adminGraphqlRequest(
      token,
      UPDATE_CATEGORY_MUTATION,
      {
        id: category.id,
        input: { name: newName, displayOrder: 7 },
      },
    ).expect(200);
    const body = response.body as { data: { updateCategory: CategoryPayload } };

    expect(body.data.updateCategory.name).toBe(newName);
    expect(body.data.updateCategory.displayOrder).toBe(7);

    const auditRow = await prisma.adminAuditLog.findFirst({
      where: { action: 'CATEGORY_UPDATED', targetKey: category.id },
    });
    expect(auditRow).not.toBeNull();
  });

  it('updateCategory re-parents a Category to another existing Category', async () => {
    const { token } = await seedFullAdmin();
    const newParent = await seedCategory({
      name: uniqueCategoryName('NuevoPadre'),
    });
    const category = await seedCategory();

    const response = await adminGraphqlRequest(
      token,
      UPDATE_CATEGORY_MUTATION,
      {
        id: category.id,
        input: { parentId: newParent.id },
      },
    ).expect(200);
    const body = response.body as { data: { updateCategory: CategoryPayload } };

    expect(body.data.updateCategory.parentId).toBe(newParent.id);
  });

  it('updateCategory rejects setting a Category as its own parent (CATEGORY_PARENT_CYCLE)', async () => {
    const { token } = await seedFullAdmin();
    const category = await seedCategory();

    const response = await adminGraphqlRequest(
      token,
      UPDATE_CATEGORY_MUTATION,
      {
        id: category.id,
        input: { parentId: category.id },
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_PARENT_CYCLE');
  });

  it("updateCategory rejects setting a Category's own descendant as its parent (CATEGORY_PARENT_CYCLE)", async () => {
    const { token } = await seedFullAdmin();
    const root = await seedCategory({ name: uniqueCategoryName('Raiz') });
    const child = await seedCategory({
      name: uniqueCategoryName('Hijo'),
      parentId: root.id,
    });

    const response = await adminGraphqlRequest(
      token,
      UPDATE_CATEGORY_MUTATION,
      {
        id: root.id,
        input: { parentId: child.id },
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_PARENT_CYCLE');
  });

  it('updateCategory returns CATEGORY_NOT_FOUND for a nonexistent id', async () => {
    const { token } = await seedFullAdmin();

    const response = await adminGraphqlRequest(
      token,
      UPDATE_CATEGORY_MUTATION,
      {
        id: '00000000-0000-0000-0000-000000000000',
        input: { name: uniqueCategoryName('Nada') },
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_NOT_FOUND');
  });

  // ---- deleteCategory -----------------------------------------------

  it('deleteCategory deletes an unused Category and writes an AdminAuditLog row', async () => {
    const { token } = await seedFullAdmin();
    const category = await seedCategory();

    const response = await adminGraphqlRequest(
      token,
      DELETE_CATEGORY_MUTATION,
      {
        id: category.id,
      },
    ).expect(200);
    const body = response.body as {
      data: { deleteCategory: { success: boolean } };
    };

    expect(body.data.deleteCategory.success).toBe(true);
    expect(
      await prisma.category.findUnique({ where: { id: category.id } }),
    ).toBeNull();
  });

  it('deleteCategory is blocked (CATEGORY_IN_USE) when the Category still has child Categories', async () => {
    const { token } = await seedFullAdmin();
    const parent = await seedCategory({ name: uniqueCategoryName('ConHijos') });
    await seedCategory({
      name: uniqueCategoryName('Hijo'),
      parentId: parent.id,
    });

    const response = await adminGraphqlRequest(
      token,
      DELETE_CATEGORY_MUTATION,
      {
        id: parent.id,
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_IN_USE');
  });

  it('deleteCategory is blocked (CATEGORY_IN_USE) when a ServiceRequest still references it', async () => {
    const { token } = await seedFullAdmin();
    const category = await seedCategory();

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail('consumer'),
        firstName: 'Juan',
        lastName: 'Perez',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.APPROVED,
      },
    });
    const customerProfile = await prisma.customerProfile.create({
      data: {
        userId: user.id,
        displayName: 'Juan Perez',
        addressLine: 'Calle Falsa 123',
        city: 'CABA',
        province: 'Buenos Aires',
        country: CountryCode.AR,
      },
    });
    await prisma.serviceRequest.create({
      data: {
        customerProfileId: customerProfile.id,
        categoryId: category.id,
        description: 'Se rompió una cañería.',
        urgency: ServiceRequestUrgency.URGENT,
      },
    });

    const response = await adminGraphqlRequest(
      token,
      DELETE_CATEGORY_MUTATION,
      {
        id: category.id,
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_IN_USE');
  });

  it('deleteCategory is blocked (CATEGORY_IN_USE) when a ProfessionalSpecialization still references it', async () => {
    const { token } = await seedFullAdmin();
    const category = await seedCategory();

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail('professional'),
        firstName: 'Ana',
        lastName: 'Gomez',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.APPROVED,
      },
    });
    const professionalProfile = await prisma.professionalProfile.create({
      data: {
        userId: user.id,
        displayName: 'Ana Gomez',
        city: 'CABA',
        country: CountryCode.AR,
        serviceAreaDescription: 'CABA',
        bio: 'Con experiencia.',
        verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
      },
    });
    await prisma.professionalSpecialization.create({
      data: {
        professionalProfileId: professionalProfile.id,
        categoryId: category.id,
        role: SpecializationRole.PRIMARY,
        description: 'Especialista.',
        order: 0,
      },
    });

    const response = await adminGraphqlRequest(
      token,
      DELETE_CATEGORY_MUTATION,
      {
        id: category.id,
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_IN_USE');
  });

  it('deleteCategory returns CATEGORY_NOT_FOUND for a nonexistent id', async () => {
    const { token } = await seedFullAdmin();

    const response = await adminGraphqlRequest(
      token,
      DELETE_CATEGORY_MUTATION,
      {
        id: '00000000-0000-0000-0000-000000000000',
      },
    ).expect(200);
    const body = response.body as { errors?: GraphQLErrorEntry[] };

    expect(body.errors?.[0]?.extensions?.code).toBe('CATEGORY_NOT_FOUND');
  });

  // ---- public schema also respects the same order -----------------------

  it("the public schema's categories query places a parent immediately before its own child too", async () => {
    const parent = await seedCategory({
      name: uniqueCategoryName('PadrePublico'),
    });
    const child = await seedCategory({
      name: uniqueCategoryName('HijoPublico'),
      parentId: parent.id,
    });

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const email = uniqueEmail('consumer-categories');
    await prisma.user.create({
      data: {
        email,
        firstName: 'Test',
        lastName: 'User',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    const sessionToken = (
      loginResponse.body as { data: { login: { sessionToken: string } } }
    ).data.login.sessionToken;

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: PUBLIC_CATEGORIES_QUERY })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    const body = response.body as { data: { categories: CategoryPayload[] } };
    const ids = body.data.categories.map((c) => c.id);

    expect(ids.indexOf(child.id)).toBe(ids.indexOf(parent.id) + 1);
  });
});
