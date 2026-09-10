import { INestApplication } from '@nestjs/common';
import { AdminUserStatus, Permission } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanAdminUsersData, createTestApp } from './support/test-app';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
  }
`;

const STORAGE_SETTINGS_QUERY = `
  query { storageSettings { profilePhotoUploadEnabled imageMaxDimensionPx imageWebpQuality } }
`;

const UPDATE_STORAGE_SETTINGS_MUTATION = `
  mutation UpdateStorageSettings($input: UpdateStorageSettingsInput!) {
    updateStorageSettings(input: $input) {
      profilePhotoUploadEnabled imageMaxDimensionPx imageWebpQuality
    }
  }
`;

const PLATFORM_SETTINGS_QUERY = `
  query { platformSettings { key } }
`;

const SET_PLATFORM_SETTING_MUTATION = `
  mutation SetPlatformSetting($input: SetPlatformSettingInput!) {
    setPlatformSetting(input: $input) { key }
  }
`;

const PASSWORD = 'super-secret-storage-settings-1';

interface GqlBody<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

function uniqueEmail(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2).padEnd(8, '0').slice(0, 8);
  return `${prefix}-${Date.now()}-${suffix}@example.com`;
}

describe('GraphQL /admin/graphql — Storage Settings (e2e, GOS-70)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdRoleIds: string[] = [];
  const originalValues: Record<string, string | null> = {};

  const STORAGE_KEYS = [
    'storage.profile-photo-upload.enabled',
    'storage.image-processing.max-dimension-px',
    'storage.image-processing.webp-quality',
  ];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    for (const key of STORAGE_KEYS) {
      const row = await prisma.platformSetting.findUnique({ where: { key } });
      originalValues[key] = row?.value ?? null;
    }
  });

  afterAll(async () => {
    for (const key of STORAGE_KEYS) {
      if (originalValues[key] !== null) {
        await prisma.platformSetting
          .updateMany({ where: { key }, data: { value: originalValues[key] } })
          .catch(() => undefined);
      }
    }
    await cleanAdminUsersData(prisma);
    await prisma.adminRole.deleteMany({
      where: { id: { in: createdRoleIds } },
    });
    await app.close();
  });

  async function seedAdmin(roleName: string, permissions: Permission[]) {
    const role = await prisma.adminRole.create({
      data: { name: roleName, permissions },
    });
    createdRoleIds.push(role.id);
    const email = uniqueEmail(roleName.toLowerCase());
    await prisma.adminUser.create({
      data: {
        email,
        displayName: `E2E ${roleName}`,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        roleId: role.id,
        status: AdminUserStatus.ACTIVE,
      },
    });
    return email;
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({
        query: ADMIN_LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    return (res.body as GqlBody<{ adminLogin: { sessionToken: string } }>).data!
      .adminLogin.sessionToken;
  }

  function adminGql(token: string | null, query: string, variables?: unknown) {
    const req = request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query, variables });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  it('storageSettings requires STORAGE_SETTINGS_READ', async () => {
    const token = await login(
      await seedAdmin('STORAGE_NO_PERMS', [Permission.AUDIT_LOG_READ]),
    );
    const res = await adminGql(token, STORAGE_SETTINGS_QUERY).expect(200);
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'ADMIN_FORBIDDEN',
    );
  });

  it('storageSettings returns the current shape for a reader', async () => {
    const token = await login(
      await seedAdmin('STORAGE_READER', [Permission.STORAGE_SETTINGS_READ]),
    );
    const res = await adminGql(token, STORAGE_SETTINGS_QUERY).expect(200);
    const body = res.body as GqlBody<{
      storageSettings: {
        profilePhotoUploadEnabled: boolean;
        imageMaxDimensionPx: number;
        imageWebpQuality: number;
      };
    }>;
    expect(body.errors).toBeUndefined();
    expect(typeof body.data!.storageSettings.profilePhotoUploadEnabled).toBe(
      'boolean',
    );
    expect([512, 1024, 2048]).toContain(
      body.data!.storageSettings.imageMaxDimensionPx,
    );
  });

  it('updateStorageSettings requires STORAGE_SETTINGS_WRITE', async () => {
    const token = await login(
      await seedAdmin('STORAGE_READER_2', [Permission.STORAGE_SETTINGS_READ]),
    );
    const res = await adminGql(token, UPDATE_STORAGE_SETTINGS_MUTATION, {
      input: {
        profilePhotoUploadEnabled: true,
        imageMaxDimensionPx: 512,
        imageWebpQuality: 70,
      },
    }).expect(200);
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'ADMIN_FORBIDDEN',
    );
  });

  it('updateStorageSettings rejects an out-of-set max dimension', async () => {
    const token = await login(
      await seedAdmin('STORAGE_WRITER', [
        Permission.STORAGE_SETTINGS_READ,
        Permission.STORAGE_SETTINGS_WRITE,
      ]),
    );
    const res = await adminGql(token, UPDATE_STORAGE_SETTINGS_MUTATION, {
      input: {
        profilePhotoUploadEnabled: true,
        imageMaxDimensionPx: 999,
        imageWebpQuality: 70,
      },
    }).expect(200);
    expect((res.body as GqlBody<unknown>).errors).toBeDefined();
  });

  it('updateStorageSettings persists and storageSettings reflects it', async () => {
    const token = await login(
      await seedAdmin('STORAGE_WRITER_2', [
        Permission.STORAGE_SETTINGS_READ,
        Permission.STORAGE_SETTINGS_WRITE,
      ]),
    );
    const res = await adminGql(token, UPDATE_STORAGE_SETTINGS_MUTATION, {
      input: {
        profilePhotoUploadEnabled: false,
        imageMaxDimensionPx: 512,
        imageWebpQuality: 55,
      },
    }).expect(200);
    const body = res.body as GqlBody<{
      updateStorageSettings: {
        profilePhotoUploadEnabled: boolean;
        imageMaxDimensionPx: number;
        imageWebpQuality: number;
      };
    }>;
    expect(body.errors).toBeUndefined();
    expect(body.data!.updateStorageSettings).toEqual({
      profilePhotoUploadEnabled: false,
      imageMaxDimensionPx: 512,
      imageWebpQuality: 55,
    });

    const read = await adminGql(token, STORAGE_SETTINGS_QUERY).expect(200);
    expect(
      (
        read.body as GqlBody<{
          storageSettings: { imageWebpQuality: number };
        }>
      ).data!.storageSettings.imageWebpQuality,
    ).toBe(55);
  });

  it('the generic setPlatformSetting rejects a storage.* key with PLATFORM_SETTING_KEY_RESERVED', async () => {
    const token = await login(
      await seedAdmin('STORAGE_AND_FLAGS', [
        Permission.FEATURE_FLAGS_READ,
        Permission.FEATURE_FLAGS_WRITE,
      ]),
    );
    const res = await adminGql(token, SET_PLATFORM_SETTING_MUTATION, {
      input: {
        key: 'storage.image-processing.webp-quality',
        description: 'x',
        valueType: 'NUMBER',
        isEncrypted: false,
        isPublic: false,
        value: '90',
      },
    }).expect(200);
    expect((res.body as GqlBody<unknown>).errors?.[0]?.extensions?.code).toBe(
      'PLATFORM_SETTING_KEY_RESERVED',
    );
  });

  it('the generic platformSettings list omits storage.* rows', async () => {
    const token = await login(
      await seedAdmin('FLAGS_READER', [Permission.FEATURE_FLAGS_READ]),
    );
    const res = await adminGql(token, PLATFORM_SETTINGS_QUERY).expect(200);
    const keys = (
      res.body as GqlBody<{ platformSettings: { key: string }[] }>
    ).data!.platformSettings.map((s) => s.key);
    expect(keys.some((k) => k.startsWith('storage.'))).toBe(false);
  });
});
