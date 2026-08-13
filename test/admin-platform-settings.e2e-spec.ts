import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminUserStatus, Permission } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanAdminUsersData,
  cleanPlatformSettingsData,
  createTestApp,
} from './support/test-app';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
  }
`;

const PLATFORM_SETTINGS_QUERY = `
  query PlatformSettings {
    platformSettings {
      key description valueType isEncrypted isPublic value maskedPreview provider updatedBy
    }
  }
`;

const SET_PLATFORM_SETTING_MUTATION = `
  mutation SetPlatformSetting($input: SetPlatformSettingInput!) {
    setPlatformSetting(input: $input) {
      key description valueType isEncrypted isPublic value maskedPreview provider updatedBy
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface PlatformSettingFields {
  key: string;
  description: string;
  valueType: string;
  isEncrypted: boolean;
  isPublic: boolean;
  value: string | null;
  maskedPreview: string | null;
  provider: string | null;
  updatedBy: string | null;
}

const PASSWORD = 'super-secret-admin-2';
const TEST_FLAG_KEY = `e2e-test-flag-${Date.now()}`;
const TEST_CREDENTIAL_KEY = `e2e-test-provider.credential-${Date.now()}`;
const TEST_CREDENTIAL_VALUE = 'super-secret-real-value-should-never-leak-9999';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * e2e coverage for `platformSettings`/`setPlatformSetting` — the Slice-3
 * consolidation of the former `featureFlags`/`setFeatureFlag` and
 * `platformCredentials`/`setPlatformCredential` (their own e2e specs, now
 * merged into this one file, mirror this file's shape). Covers: permission
 * enforcement (`AdminPermissionsGuard`), the upsert-plus-audit transaction
 * for BOTH a non-encrypted (flag-shaped) and an encrypted (credential-shaped)
 * setting, negative authorization, and the NON-NEGOTIABLE rule that a real
 * secret value never appears anywhere in a raw response body.
 */
describe('GraphQL /admin/graphql — platformSettings/setPlatformSetting (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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

  // This suite calls `loginAndGetToken` up to 8 times (a fresh admin+role
  // per test, for isolation) — more than `adminLogin`'s own 5-per-60s
  // throttle (see `admin-auth.resolver.ts`) allows within one suite run.
  // Confirmed live: without this, the later tests in the file failed with
  // `Cannot read properties of null (reading 'adminLogin')` — the throttle
  // silently rejecting the login before it ever reached the resolver.
  // Flushing before EACH test (not just once in `afterAll`, which is too
  // late to help sibling tests in the same file) resets the counter.
  beforeEach(async () => {
    await flushRedis();
  });

  afterAll(async () => {
    await cleanPlatformSettingsData(prisma, [
      TEST_FLAG_KEY,
      TEST_CREDENTIAL_KEY,
    ]);
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
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
    });
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

  async function loginAndGetToken(email: string): Promise<string> {
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

  it('setPlatformSetting succeeds for a non-encrypted (flag-shaped) setting, upserting it and writing an AdminAuditLog row', async () => {
    const { email } = await seedAdminWithRole('CONFIG_MANAGER_E2E', [
      Permission.FEATURE_FLAGS_READ,
      Permission.FEATURE_FLAGS_WRITE,
    ]);
    const token = await loginAndGetToken(email);

    const response = await adminGraphqlRequest(
      token,
      SET_PLATFORM_SETTING_MUTATION,
      {
        input: {
          key: TEST_FLAG_KEY,
          description: 'e2e test flag',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          isPublic: true,
          value: 'true',
        },
      },
    ).expect(200);
    const body = response.body as {
      data: { setPlatformSetting: PlatformSettingFields } | null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data?.setPlatformSetting).toEqual({
      key: TEST_FLAG_KEY,
      description: 'e2e test flag',
      valueType: 'BOOLEAN',
      isEncrypted: false,
      isPublic: true,
      value: 'true',
      maskedPreview: null,
      provider: null,
      updatedBy: 'E2E CONFIG_MANAGER_E2E',
    });

    const row = await prisma.platformSetting.findUnique({
      where: { key: TEST_FLAG_KEY },
    });
    expect(row?.value).toBe('true');
    expect(row?.isEncrypted).toBe(false);

    const auditRows = await prisma.adminAuditLog.findMany({
      where: { targetType: 'PlatformSetting', targetKey: TEST_FLAG_KEY },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[auditRows.length - 1].action).toBe('PLATFORM_SETTING_SET');
    expect(auditRows[auditRows.length - 1].metadata).toEqual({ value: 'true' });
  });

  it('setPlatformSetting succeeds for an encrypted (credential-shaped) setting, upserting it (encrypted) and writing an AdminAuditLog row that never contains the plaintext', async () => {
    const { email } = await seedAdminWithRole('CREDENTIALS_MANAGER_E2E', [
      Permission.FEATURE_FLAGS_READ,
      Permission.FEATURE_FLAGS_WRITE,
    ]);
    const token = await loginAndGetToken(email);

    const response = await adminGraphqlRequest(
      token,
      SET_PLATFORM_SETTING_MUTATION,
      {
        input: {
          key: TEST_CREDENTIAL_KEY,
          description: 'e2e test credential',
          valueType: 'STRING',
          isEncrypted: true,
          isPublic: false,
          provider: 'TEST_PROVIDER',
          value: TEST_CREDENTIAL_VALUE,
        },
      },
    ).expect(200);
    const body = response.body as {
      data: { setPlatformSetting: PlatformSettingFields } | null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data?.setPlatformSetting.value).toBeNull();
    expect(body.data?.setPlatformSetting.maskedPreview).toBe('•••9999');
    expect(body.data?.setPlatformSetting.provider).toBe('TEST_PROVIDER');

    // The raw response body, stringified, must NEVER contain the real value.
    expect(JSON.stringify(response.body)).not.toContain(TEST_CREDENTIAL_VALUE);

    const row = await prisma.platformSetting.findUnique({
      where: { key: TEST_CREDENTIAL_KEY },
    });
    expect(row?.isEncrypted).toBe(true);
    expect(row?.value).toBeNull();
    expect(row?.ciphertext?.toString('utf8')).not.toBe(TEST_CREDENTIAL_VALUE);

    const auditRows = await prisma.adminAuditLog.findMany({
      where: {
        targetType: 'PlatformSetting',
        targetKey: TEST_CREDENTIAL_KEY,
      },
    });
    const lastAudit = auditRows[auditRows.length - 1];
    expect(lastAudit.action).toBe('PLATFORM_SETTING_SET');
    expect(JSON.stringify(lastAudit.metadata)).not.toContain(
      TEST_CREDENTIAL_VALUE,
    );
    expect(lastAudit.metadata).toEqual({ maskedPreview: '•••9999' });
  });

  it('setPlatformSetting rejects isEncrypted:true combined with isPublic:true with a clear domain error, BEFORE any row is written', async () => {
    const { email } = await seedAdminWithRole('ENCRYPTED_PUBLIC_VETO_E2E', [
      Permission.FEATURE_FLAGS_READ,
      Permission.FEATURE_FLAGS_WRITE,
    ]);
    const token = await loginAndGetToken(email);
    const vetoKey = `e2e-encrypted-public-veto-${Date.now()}`;

    const response = await adminGraphqlRequest(
      token,
      SET_PLATFORM_SETTING_MUTATION,
      {
        input: {
          key: vetoKey,
          description: 'should be rejected before any write',
          valueType: 'STRING',
          isEncrypted: true,
          isPublic: true,
          provider: 'TEST_PROVIDER',
          value: 'irrelevant',
        },
      },
    ).expect(200);
    const body = response.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe(
      'PLATFORM_SETTING_ENCRYPTED_CANNOT_BE_PUBLIC',
    );

    const row = await prisma.platformSetting.findUnique({
      where: { key: vetoKey },
    });
    expect(row).toBeNull();
  });

  it('platformSettings is readable by an admin with only FEATURE_FLAGS_READ, and never exposes a plaintext value for an encrypted row', async () => {
    const { email } = await seedAdminWithRole('SUPPORT_VIEWER_E2E', [
      Permission.FEATURE_FLAGS_READ,
    ]);
    const token = await loginAndGetToken(email);

    const response = await adminGraphqlRequest(
      token,
      PLATFORM_SETTINGS_QUERY,
    ).expect(200);
    const body = response.body as {
      data: { platformSettings: PlatformSettingFields[] } | null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(Array.isArray(body.data?.platformSettings)).toBe(true);
    const credentialRow = body.data?.platformSettings.find(
      (s) => s.key === TEST_CREDENTIAL_KEY,
    );
    expect(credentialRow?.value).toBeNull();
    expect(credentialRow?.maskedPreview).toBe('•••9999');
    expect(JSON.stringify(response.body)).not.toContain(TEST_CREDENTIAL_VALUE);
  });

  it('setPlatformSetting rejects with ADMIN_FORBIDDEN for a read-only (SUPPORT_VIEWER-shaped) admin — negative authorization', async () => {
    const { email } = await seedAdminWithRole('SUPPORT_VIEWER_E2E_2', [
      Permission.FEATURE_FLAGS_READ,
    ]);
    const token = await loginAndGetToken(email);

    const response = await adminGraphqlRequest(
      token,
      SET_PLATFORM_SETTING_MUTATION,
      {
        input: {
          key: TEST_FLAG_KEY,
          description: 'attempted-write-by-read-only-admin',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          isPublic: true,
          value: 'false',
        },
      },
    ).expect(200);
    const body = response.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('ADMIN_FORBIDDEN');
    expect(body.errors?.[0].message).toBe(
      'You do not have permission to perform this action.',
    );
  });

  it('setPlatformSetting rejects with ADMIN_UNAUTHENTICATED when no session token is sent at all', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({
        query: SET_PLATFORM_SETTING_MUTATION,
        variables: {
          input: {
            key: TEST_FLAG_KEY,
            description: 'x',
            valueType: 'BOOLEAN',
            isEncrypted: false,
            isPublic: true,
            value: 'true',
          },
        },
      })
      .expect(200);
    const body = response.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
  });

  it('platformSettings rejects with ADMIN_FORBIDDEN for an admin with no FEATURE_FLAGS_READ permission', async () => {
    const { email } = await seedAdminWithRole('NO_SETTINGS_PERM_E2E', []);
    const token = await loginAndGetToken(email);

    const response = await adminGraphqlRequest(
      token,
      PLATFORM_SETTINGS_QUERY,
    ).expect(200);
    const body = response.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('ADMIN_FORBIDDEN');
  });

  it('a request asking for a plaintext "value" alongside isEncrypted:true still gets null — the field exists on the schema but the resolver enforces the guardrail at read time', async () => {
    const { email } = await seedAdminWithRole('VALUE_GUARDRAIL_E2E', [
      Permission.FEATURE_FLAGS_READ,
    ]);
    const token = await loginAndGetToken(email);

    const response = await adminGraphqlRequest(
      token,
      PLATFORM_SETTINGS_QUERY,
    ).expect(200);
    const body = response.body as {
      data: { platformSettings: PlatformSettingFields[] } | null;
    };
    const encryptedRows = body.data?.platformSettings.filter(
      (s) => s.isEncrypted,
    );
    expect(encryptedRows?.length).toBeGreaterThan(0);
    for (const row of encryptedRows ?? []) {
      expect(row.value).toBeNull();
    }
  });
});
