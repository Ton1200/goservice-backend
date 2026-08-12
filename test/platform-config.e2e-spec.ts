import { INestApplication } from '@nestjs/common';
import { AdminUserStatus, Permission } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types';
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

const SET_PLATFORM_SETTING_MUTATION = `
  mutation SetPlatformSetting($input: SetPlatformSettingInput!) {
    setPlatformSetting(input: $input) { key isEncrypted }
  }
`;

const PLATFORM_CONFIG_QUERY = `
  query PlatformConfig {
    platformConfig
  }
`;

interface GraphQLErrorEntry {
  message: string;
}

type PlatformConfigTree = Record<string, unknown>;

const PASSWORD = 'super-secret-admin-2';
const TEST_GROUP_PREFIX = `e2ePublicFeature${Date.now()}`;
const TEST_PUBLIC_KEY = `${TEST_GROUP_PREFIX}.enabled`;
const TEST_SIBLING_KEY = `${TEST_GROUP_PREFIX}.client-id`;
// A second sibling GROUP under the same parent as `TEST_GROUP_PREFIX` (both
// nest under `${TEST_PARENT_PREFIX}`) — proves two distinct feature
// branches merge correctly into the SAME parent object rather than each
// producing its own separate top-level tree.
const TEST_PARENT_PREFIX = `e2ePublicParent${Date.now()}`;
const TEST_CHILD_A_KEY = `${TEST_PARENT_PREFIX}.branchA.enabled`;
const TEST_CHILD_B_KEY = `${TEST_PARENT_PREFIX}.branchB.enabled`;
// Deliberately no `-` anywhere in this key — isolates the "single-segment
// key" edge case (no nesting at all, straight to a top-level leaf) from the
// separate kebab-case -> camelCase segment transform (already covered by
// the "enabled"/"client-id" cases above).
const TEST_ROOT_KEY = `e2epublicfeatureroot${Date.now()}`;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

function getAtPath(tree: PlatformConfigTree, path: string[]): unknown {
  let cursor: unknown = tree;
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * e2e coverage for the consumer-facing, UNAUTHENTICATED `platformConfig`
 * query (`/graphql`) — see
 * `src/platform-admin/platform-settings/public/platform-config.resolver.ts`
 * for why no auth guard is deliberate.
 *
 * Reshaped a SECOND time (2026-08-09, same day, confirmed with the human
 * via a concrete JSON preview) from `[PlatformConfigGroup!]!` (one entry
 * per feature, each a flat `fields: JSON!` map, group key = dot-path with
 * its last segment dropped) to a single bare `JSON!` scalar: the whole
 * response is now ONE deeply nested object, built by walking EVERY dot
 * segment of every non-encrypted setting's key (not just a fixed two
 * levels). This suite proves: reachable without a session token at all,
 * builds an arbitrarily deep nested object (not an array), camelCases each
 * kebab-case key segment, only ever includes rows that are
 * `isEncrypted: false` (the ONLY gate deciding public exposure), that a
 * setting becoming encrypted via the admin mutation actually removes it
 * from the tree on the very next read (no caching), and that two sibling
 * branches under the same parent merge into one tree rather than
 * overwriting each other. Also proves (2026-08-10 follow-up) that a KNOWN
 * boolean feature flag (`KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS`) with no
 * `PlatformSetting` row at all still appears in the tree, defaulting to
 * `false` — see the dedicated describe block below.
 */
describe('GraphQL /graphql — platformConfig (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanPlatformSettingsData(prisma, [
      TEST_PUBLIC_KEY,
      TEST_SIBLING_KEY,
      TEST_CHILD_A_KEY,
      TEST_CHILD_B_KEY,
      TEST_ROOT_KEY,
    ]);
    await cleanAdminUsersData(prisma);
    await app.close();
  });

  async function seedAdmin(): Promise<string> {
    const role = await prisma.adminRole.upsert({
      where: { name: 'PUBLIC_FEATURES_E2E_ADMIN' },
      update: {
        permissions: [
          Permission.FEATURE_FLAGS_READ,
          Permission.FEATURE_FLAGS_WRITE,
        ],
      },
      create: {
        name: 'PUBLIC_FEATURES_E2E_ADMIN',
        permissions: [
          Permission.FEATURE_FLAGS_READ,
          Permission.FEATURE_FLAGS_WRITE,
        ],
      },
    });
    const email = uniqueEmail('public-features-admin');
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await prisma.adminUser.create({
      data: {
        email,
        displayName: 'E2E Public Features Admin',
        passwordHash,
        roleId: role.id,
        status: AdminUserStatus.ACTIVE,
      },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({
        query: ADMIN_LOGIN_MUTATION,
        variables: { input: { email, password: PASSWORD } },
      })
      .expect(200);
    return (
      loginResponse.body as {
        data: { adminLogin: { sessionToken: string } };
      }
    ).data.adminLogin.sessionToken;
  }

  async function setBooleanSetting(
    token: string,
    key: string,
    isEncrypted: boolean,
  ): Promise<void> {
    // `isPublic: true` for the non-encrypted branch — GOS-3x follow-up #2
    // (2026-08-10) made `isPublic` an independent, default-OFF opt-in, so a
    // test that wants a setting to actually SHOW UP in `platformConfig` must
    // now say so explicitly. The encrypted branch always sends
    // `isPublic: false` — `isEncrypted: true` + `isPublic: true` is a hard
    // veto rejected by `SetPlatformSettingService` before any write.
    await request(app.getHttpServer())
      .post('/admin/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({
        query: SET_PLATFORM_SETTING_MUTATION,
        variables: {
          input: isEncrypted
            ? {
                key,
                description: 'e2e public feature',
                valueType: 'STRING',
                isEncrypted: true,
                isPublic: false,
                provider: 'TEST_PROVIDER',
                value: 'irrelevant-secret-value',
              }
            : {
                key,
                description: 'e2e public feature',
                valueType: 'BOOLEAN',
                isEncrypted: false,
                isPublic: true,
                value: 'true',
              },
        },
      })
      .expect(200);
  }

  async function setStringSetting(
    token: string,
    key: string,
    isPublic = true,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post('/admin/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({
        query: SET_PLATFORM_SETTING_MUTATION,
        variables: {
          input: {
            key,
            description: 'e2e public feature sibling',
            valueType: 'STRING',
            isEncrypted: false,
            isPublic,
            value: 'some-public-value',
          },
        },
      })
      .expect(200);
  }

  async function platformConfigRequest() {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query: PLATFORM_CONFIG_QUERY })
      .expect(200);
  }

  it('is reachable WITHOUT any Authorization header / session token, and returns a single nested object (not an array)', async () => {
    const response = await platformConfigRequest();
    const body = response.body as {
      data: { platformConfig: PlatformConfigTree } | null;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(Array.isArray(body.data?.platformConfig)).toBe(false);
    expect(typeof body.data?.platformConfig).toBe('object');
    expect(body.data?.platformConfig).not.toBeNull();
  });

  /**
   * GOS-3x follow-up #2 (2026-08-10) — proves the migration's data-fixup
   * step actually ran: the two seeded `customer.social-login.<provider>.enabled`
   * rows must be `isPublic: true` (their `prisma/seed.ts` shape as of this
   * change) for `platformConfig` to keep returning their REAL saved value
   * (`true`, the seeded default) rather than silently falling back to
   * `KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS`' own default of `false` — the
   * exact regression this migration's data-fixup step exists to prevent
   * (mobile's WelcomeScreen/LoginScreen social-login buttons silently
   * disappearing). If this test ever reads `false` here, it does NOT
   * necessarily mean the flag was turned off — it may mean the row's
   * `isPublic` reverted to `false` (not public), and the manifest's default
   * is masking that.
   */
  it('the seeded customer.social-login.<provider>.enabled rows are isPublic:true post-migration, and platformConfig reflects their real saved value, not the manifest default', async () => {
    const googleRow = await prisma.platformSetting.findUnique({
      where: { key: 'customer.social-login.google.enabled' },
    });
    const appleRow = await prisma.platformSetting.findUnique({
      where: { key: 'customer.social-login.apple.enabled' },
    });
    expect(googleRow?.isPublic).toBe(true);
    expect(appleRow?.isPublic).toBe(true);

    const response = await platformConfigRequest();
    const body = response.body as {
      data: { platformConfig: PlatformConfigTree };
    };

    // Both seeded flags default to the string 'true' (see
    // `prisma/seed.ts`) — if `platformConfig` were instead falling back to
    // the manifest's own default (`false`) because the real row had become
    // non-public, this would read `false`, not `true`.
    expect(
      getAtPath(body.data.platformConfig, [
        'customer',
        'socialLogin',
        'google',
        'enabled',
      ]),
    ).toBe(true);
    expect(
      getAtPath(body.data.platformConfig, [
        'customer',
        'socialLogin',
        'apple',
        'enabled',
      ]),
    ).toBe(true);
  });

  /**
   * The actual regression-guard this whole round introduces: a brand-new,
   * non-encrypted setting is now backend/admin-only BY DEFAULT
   * (`isPublic: false`), not automatically public just because it isn't a
   * secret. Before GOS-3x follow-up #2, this exact setup (isEncrypted:
   * false, no isPublic concept) WOULD have appeared in the tree.
   */
  it('a non-encrypted setting with isPublic:false does NOT appear in platformConfig', async () => {
    const token = await seedAdmin();
    const nonPublicKey = `e2eNonPublicSetting${Date.now()}`;
    await setStringSetting(token, nonPublicKey, false);

    const response = await platformConfigRequest();
    const body = response.body as {
      data: { platformConfig: PlatformConfigTree };
    };

    expect(getAtPath(body.data.platformConfig, [nonPublicKey])).toBeUndefined();

    await cleanPlatformSettingsData(prisma, [nonPublicKey]);
  });

  it('a fully-configured feature (e.g. Google) nests its "enabled" and "client-id" settings under the same parent path, camelCased', async () => {
    const token = await seedAdmin();
    await setBooleanSetting(token, TEST_PUBLIC_KEY, false);
    await setStringSetting(token, TEST_SIBLING_KEY);

    const response = await platformConfigRequest();
    const body = response.body as {
      data: { platformConfig: PlatformConfigTree };
    };

    expect(getAtPath(body.data.platformConfig, [TEST_GROUP_PREFIX])).toEqual({
      enabled: true,
      clientId: 'some-public-value',
    });
  });

  it('two sibling branches under the same parent merge into one tree rather than overwriting each other', async () => {
    const token = await seedAdmin();
    await setBooleanSetting(token, TEST_CHILD_A_KEY, false);
    await setBooleanSetting(token, TEST_CHILD_B_KEY, false);

    const response = await platformConfigRequest();
    const body = response.body as {
      data: { platformConfig: PlatformConfigTree };
    };

    expect(getAtPath(body.data.platformConfig, [TEST_PARENT_PREFIX])).toEqual({
      branchA: { enabled: true },
      branchB: { enabled: true },
    });
  });

  it('a single-segment key (no dot at all) becomes a top-level leaf', async () => {
    const token = await seedAdmin();
    await setBooleanSetting(token, TEST_ROOT_KEY, false);

    const response = await platformConfigRequest();
    const body = response.body as {
      data: { platformConfig: PlatformConfigTree };
    };

    expect(getAtPath(body.data.platformConfig, [TEST_ROOT_KEY])).toBe(true);
  });

  it('removes a setting from the tree on the very next read once it becomes encrypted — no caching', async () => {
    const token = await seedAdmin();
    await setBooleanSetting(token, TEST_PUBLIC_KEY, false);

    let response = await platformConfigRequest();
    let body = response.body as {
      data: { platformConfig: PlatformConfigTree };
    };
    expect(
      getAtPath(body.data.platformConfig, [TEST_GROUP_PREFIX, 'enabled']),
    ).toBe(true);

    await setBooleanSetting(token, TEST_PUBLIC_KEY, true);

    response = await platformConfigRequest();
    body = response.body as { data: { platformConfig: PlatformConfigTree } };
    expect(
      getAtPath(body.data.platformConfig, [TEST_GROUP_PREFIX, 'enabled']),
    ).toBeUndefined();
  });

  it('never returns an encrypted setting anywhere in the tree, even one that (pre-guardrail) would otherwise match by key path', async () => {
    const response = await platformConfigRequest();
    const body = response.body as {
      data: { platformConfig: PlatformConfigTree };
    };
    // The real, seeded `customer.social-login.<provider>.client-id` rows
    // are `isEncrypted: true` in the admin panel's baseline configuration —
    // confirms they never leak through this query, not just a synthetic
    // example. `isEncrypted` is the ONLY gate deciding public exposure —
    // see `PlatformSetting`'s own header comment in `prisma/schema.prisma`.
    const socialLogin = getAtPath(body.data.platformConfig, [
      'customer',
      'socialLogin',
    ]) as Record<string, Record<string, unknown>> | undefined;
    if (socialLogin) {
      for (const providerConfig of Object.values(socialLogin)) {
        expect(providerConfig.clientId).toBeUndefined();
      }
    }
  });

  /**
   * GOS-30/31/32 follow-up (2026-08-10, human-requested): proves the
   * `KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS` default-fill pass (see
   * `ListPlatformConfigService.applyKnownBooleanDefaults` and
   * `known-platform-config-defaults.ts`) live, against the real DB — not
   * just the service's own unit tests. Deliberately targets ONLY
   * `customer.social-login.apple.enabled`, never `.google.enabled` (the
   * other seeded flag), and restores it afterward — same
   * scoped-mutate/restore pattern already established by
   * `test/auth-social-login.e2e-spec.ts`'s own "PlatformSettingPort.isEnabled
   * gate" describe block, so this suite never leaks state into any other
   * e2e file that depends on both seeded flags existing with their seeded
   * `'true'` default.
   */
  describe('known boolean default-fill (KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS)', () => {
    afterEach(async () => {
      // Upsert (not just `update`) — resilient even though this describe
      // block's own test fully DELETES the row rather than merely mutating
      // it, restoring it to `prisma/seed.ts`'s own seeded shape/value.
      await prisma.platformSetting.upsert({
        where: { key: 'customer.social-login.apple.enabled' },
        update: { value: 'true', isPublic: true },
        create: {
          key: 'customer.social-login.apple.enabled',
          description: 'Gates Apple sign-in (socialLogin APPLE).',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          isPublic: true,
          value: 'true',
        },
      });
    });

    it('a known boolean flag with no PlatformSetting row at all still appears in platformConfig, defaulting to false — never just missing', async () => {
      await prisma.platformSetting.delete({
        where: { key: 'customer.social-login.apple.enabled' },
      });

      const response = await platformConfigRequest();
      const body = response.body as {
        data: { platformConfig: PlatformConfigTree };
      };

      expect(
        getAtPath(body.data.platformConfig, [
          'customer',
          'socialLogin',
          'apple',
          'enabled',
        ]),
      ).toBe(false);
    });
  });

  it('a query literal asking for sub-fields fails at the GraphQL layer — JSON is a leaf scalar, not selectable further', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query { platformConfig { customer } }`,
      })
      .expect(400);
    const body = response.body as { errors?: GraphQLErrorEntry[] };
    expect(body.errors?.[0].message).toMatch(
      /must not have a selection since type "JSON!" has no subfields/,
    );
  });

  it('the `prefix` argument no longer exists on this query', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query { platformConfig(prefix: "customer") }`,
      })
      .expect(400);
    const body = response.body as { errors?: GraphQLErrorEntry[] };
    expect(body.errors?.[0].message).toMatch(
      /Unknown argument "prefix" on field/,
    );
  });
});
