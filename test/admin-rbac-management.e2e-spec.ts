import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminUserStatus, Permission } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashAdminInviteToken } from '../src/platform-admin/admin-invites/services/admin-invite-token.util';
import {
  cleanAdminUsersData,
  createTestApp,
  enableTestEmailDelivery,
} from './support/test-app';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
  }
`;

const ADMIN_ME_QUERY = `query AdminMe { adminMe }`;

const ADMIN_ROLES_QUERY = `
  query AdminRoles {
    adminRoles { id name permissions }
  }
`;

const CREATE_ADMIN_ROLE_MUTATION = `
  mutation CreateAdminRole($input: CreateAdminRoleInput!) {
    createAdminRole(input: $input) { id name permissions }
  }
`;

const UPDATE_ADMIN_ROLE_PERMISSIONS_MUTATION = `
  mutation UpdateAdminRolePermissions($id: ID!, $permissions: [Permission!]!) {
    updateAdminRolePermissions(id: $id, permissions: $permissions) { id permissions }
  }
`;

const DELETE_ADMIN_ROLE_MUTATION = `
  mutation DeleteAdminRole($id: ID!) {
    deleteAdminRole(id: $id) { success }
  }
`;

const ADMIN_USERS_QUERY = `
  query AdminUsers($limit: Int, $offset: Int) {
    adminUsers(limit: $limit, offset: $offset) {
      totalCount
      items { id email displayName status role { id name } }
    }
  }
`;

const UPDATE_ADMIN_USER_MUTATION = `
  mutation UpdateAdminUser($id: ID!, $input: UpdateAdminUserInput!) {
    updateAdminUser(id: $id, input: $input) { id status role { id } }
  }
`;

const INVITE_ADMIN_USER_MUTATION = `
  mutation InviteAdminUser($input: InviteAdminUserInput!) {
    inviteAdminUser(input: $input) { id email status }
  }
`;

const RESEND_ADMIN_INVITE_MUTATION = `
  mutation ResendAdminInvite($adminUserId: ID!) {
    resendAdminInvite(adminUserId: $adminUserId) { success }
  }
`;

const DELETE_ADMIN_USER_MUTATION = `
  mutation DeleteAdminUser($id: ID!) {
    deleteAdminUser(id: $id) { success }
  }
`;

const ACCEPT_ADMIN_INVITE_MUTATION = `
  mutation AcceptAdminInvite($input: AcceptAdminInviteInput!) {
    acceptAdminInvite(input: $input) { success errors { code message } }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

const PASSWORD = 'super-secret-admin-rbac-1';

/** Same fixed-length-suffix fix `admin-user-accounts.e2e-spec.ts` already
 * documents for its own `uniqueEmail` — avoids an intermittent `BAD_REQUEST`
 * from a long role-name-derived local-part occasionally exceeding RFC
 * 5321's 64-char limit. */
function uniqueEmail(prefix: string): string {
  const randomSuffix = Math.random()
    .toString(36)
    .slice(2)
    .padEnd(8, '0')
    .slice(0, 8);
  return `${prefix}-${Date.now()}-${randomSuffix}@example.com`;
}

/**
 * e2e coverage for the Administrators tab: role/permission management
 * (`adminRoles`/`createAdminRole`/`updateAdminRolePermissions`/
 * `deleteAdminRole`) + admin-user invite/manage
 * (`adminUsers`/`updateAdminUser`/`inviteAdminUser`/`resendAdminInvite`/
 * `acceptAdminInvite`) — the two safety guards this feature exists to
 * protect (self-lockout, self-revocation) get explicit, dedicated coverage,
 * both branches (rejected AND still-allowed) for each.
 */
describe('GraphQL /admin/graphql — Administrators tab (roles/admin-users/invites) (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdRoleIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    await enableTestEmailDelivery(prisma);
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
    await cleanAdminUsersData(prisma);
    await prisma.adminRole.deleteMany({
      where: { id: { in: createdRoleIds } },
    });
    await flushRedis();
    await app.close();
  });

  async function seedAdminWithRole(
    roleName: string,
    permissions: Permission[],
  ) {
    const role = await prisma.adminRole.create({
      data: { name: roleName, permissions },
    });
    createdRoleIds.push(role.id);
    const email = uniqueEmail(roleName.toLowerCase());
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const adminUser = await prisma.adminUser.create({
      data: {
        email,
        displayName: `E2E ${roleName}`,
        passwordHash,
        roleId: role.id,
        status: AdminUserStatus.ACTIVE,
      },
    });
    return { email, adminUserId: adminUser.id, roleId: role.id };
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
    token: string | null,
    query: string,
    variables?: unknown,
  ) {
    const req = request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query, variables });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  /**
   * `AdminLockoutGuardService`'s read is DELIBERATELY global/unfiltered
   * (see that service's own header comment) — it considers every `ACTIVE`
   * `AdminUser` in the ENTIRE system, not just ones this suite created. That
   * makes a REJECTING lockout-guard assertion non-deterministic against a
   * shared dev database that may already hold other real, unrelated
   * `ACTIVE` admins with `ADMIN_USERS_MANAGE` (confirmed live: it does, on
   * this machine). This helper makes such an assertion deterministic
   * WITHOUT deleting or otherwise permanently touching any pre-existing
   * data: it temporarily sets every OTHER such admin's status to
   * `REVOKED` for the duration of `fn`, then restores each one's EXACT
   * original status in a `finally` — reversible, minimal-blast-radius, and
   * scoped to only the two tests that actually need this determinism.
   */
  async function withOnlyTheseAdminsHoldingManage<T>(
    testAdminIds: string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    const others = await prisma.adminUser.findMany({
      where: {
        status: AdminUserStatus.ACTIVE,
        id: { notIn: testAdminIds },
        role: { permissions: { has: Permission.ADMIN_USERS_MANAGE } },
      },
      select: { id: true, status: true },
    });

    await Promise.all(
      others.map((other) =>
        prisma.adminUser.update({
          where: { id: other.id },
          data: { status: AdminUserStatus.REVOKED },
        }),
      ),
    );

    try {
      return await fn();
    } finally {
      await Promise.all(
        others.map((other) =>
          prisma.adminUser.update({
            where: { id: other.id },
            data: { status: other.status },
          }),
        ),
      );
    }
  }

  describe('adminRoles / createAdminRole / updateAdminRolePermissions / deleteAdminRole', () => {
    it('creates a role, lists it, edits its permissions, and deletes it — with an AdminAuditLog row for each write', async () => {
      const { email } = await seedAdminWithRole('MGR_ROLES_CRUD_E2E', [
        Permission.ADMIN_USERS_MANAGE,
      ]);
      const token = await loginAndGetToken(email);

      const createResponse = await adminGraphqlRequest(
        token,
        CREATE_ADMIN_ROLE_MUTATION,
        {
          input: {
            name: uniqueEmail('ROLE')
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '_'),
            permissions: [Permission.SERVICE_REQUESTS_READ],
          },
        },
      ).expect(200);
      const createBody = createResponse.body as {
        data: { createAdminRole: { id: string; permissions: string[] } };
        errors?: GraphQLErrorEntry[];
      };
      expect(createBody.errors).toBeUndefined();
      const roleId = createBody.data.createAdminRole.id;
      createdRoleIds.push(roleId);

      const listResponse = await adminGraphqlRequest(
        token,
        ADMIN_ROLES_QUERY,
      ).expect(200);
      const listBody = listResponse.body as {
        data: { adminRoles: { id: string }[] };
      };
      expect(listBody.data.adminRoles.some((r) => r.id === roleId)).toBe(true);

      const updateResponse = await adminGraphqlRequest(
        token,
        UPDATE_ADMIN_ROLE_PERMISSIONS_MUTATION,
        { id: roleId, permissions: [Permission.CATEGORIES_READ] },
      ).expect(200);
      const updateBody = updateResponse.body as {
        data: { updateAdminRolePermissions: { permissions: string[] } };
        errors?: GraphQLErrorEntry[];
      };
      expect(updateBody.errors).toBeUndefined();
      expect(updateBody.data.updateAdminRolePermissions.permissions).toEqual([
        Permission.CATEGORIES_READ,
      ]);

      const deleteResponse = await adminGraphqlRequest(
        token,
        DELETE_ADMIN_ROLE_MUTATION,
        { id: roleId },
      ).expect(200);
      const deleteBody = deleteResponse.body as {
        data: { deleteAdminRole: { success: boolean } };
        errors?: GraphQLErrorEntry[];
      };
      expect(deleteBody.errors).toBeUndefined();
      expect(deleteBody.data.deleteAdminRole.success).toBe(true);

      const auditRows = await prisma.adminAuditLog.findMany({
        where: { targetType: 'AdminRole', targetKey: roleId },
      });
      expect(auditRows.map((r) => r.action).sort()).toEqual(
        [
          'ADMIN_ROLE_CREATED',
          'ADMIN_ROLE_DELETED',
          'ADMIN_ROLE_PERMISSIONS_UPDATED',
        ].sort(),
      );
    });

    it('rejects deleting a seeded system role (SUPPORT_VIEWER) with ADMIN_ROLE_IS_SYSTEM_ROLE', async () => {
      const { email } = await seedAdminWithRole('MGR_ROLES_SYSTEM_E2E', [
        Permission.ADMIN_USERS_MANAGE,
      ]);
      const token = await loginAndGetToken(email);

      const seededRole = await prisma.adminRole.findUnique({
        where: { name: 'SUPPORT_VIEWER' },
      });
      expect(seededRole).not.toBeNull();

      const response = await adminGraphqlRequest(
        token,
        DELETE_ADMIN_ROLE_MUTATION,
        { id: seededRole!.id },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe(
        'ADMIN_ROLE_IS_SYSTEM_ROLE',
      );
    });

    it('rejects deleting a role still assigned to an AdminUser with ADMIN_ROLE_IN_USE', async () => {
      const { email, roleId } = await seedAdminWithRole('MGR_ROLES_INUSE_E2E', [
        Permission.ADMIN_USERS_MANAGE,
      ]);
      const token = await loginAndGetToken(email);

      const response = await adminGraphqlRequest(
        token,
        DELETE_ADMIN_ROLE_MUTATION,
        { id: roleId },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('ADMIN_ROLE_IN_USE');
    });

    it("allows editing SUPER_ADMIN's own permission set (explicit human decision — no name-based restriction on updateAdminRolePermissions)", async () => {
      const { email } = await seedAdminWithRole('MGR_SUPER_ADMIN_EDIT_E2E', [
        Permission.ADMIN_USERS_MANAGE,
      ]);
      const token = await loginAndGetToken(email);

      const superAdminRole = await prisma.adminRole.findUnique({
        where: { name: 'SUPER_ADMIN' },
      });
      expect(superAdminRole).not.toBeNull();
      const currentPermissions = superAdminRole!.permissions;

      // Add a harmless extra permission (already present, so this is a
      // true no-op write — proves the mutation itself is reachable/allowed
      // against SUPER_ADMIN without asserting a real permission change,
      // since mutating the real, shared SUPER_ADMIN row's permissions in a
      // suite that shares this DB with other suites would be unsafe).
      const response = await adminGraphqlRequest(
        token,
        UPDATE_ADMIN_ROLE_PERMISSIONS_MUTATION,
        { id: superAdminRole!.id, permissions: currentPermissions },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
    });
  });

  describe('self-lockout guard', () => {
    it('ROLE_PERMISSIONS_UPDATE: rejects removing ADMIN_USERS_MANAGE from the only role holding it when doing so would leave zero ACTIVE admins with the permission', async () => {
      const { email, adminUserId, roleId } = await seedAdminWithRole(
        'LOCKOUT_ROLE_ONLY_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const token = await loginAndGetToken(email);

      await withOnlyTheseAdminsHoldingManage([adminUserId], async () => {
        const response = await adminGraphqlRequest(
          token,
          UPDATE_ADMIN_ROLE_PERMISSIONS_MUTATION,
          { id: roleId, permissions: [Permission.AUDIT_LOG_READ] },
        ).expect(200);
        const body = response.body as {
          data: unknown;
          errors?: GraphQLErrorEntry[];
        };
        expect(body.data).toBeNull();
        expect(body.errors?.[0].extensions?.code).toBe(
          'WOULD_LOCK_OUT_ADMIN_MANAGEMENT',
        );
      });
    });

    it('ROLE_PERMISSIONS_UPDATE: allows removing ADMIN_USERS_MANAGE from one role when ANOTHER ACTIVE admin still holds it via a different role', async () => {
      const { roleId: roleAId } = await seedAdminWithRole(
        'LOCKOUT_ROLE_A_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const { email: emailB } = await seedAdminWithRole('LOCKOUT_ROLE_B_E2E', [
        Permission.ADMIN_USERS_MANAGE,
      ]);
      const tokenB = await loginAndGetToken(emailB);

      const response = await adminGraphqlRequest(
        tokenB,
        UPDATE_ADMIN_ROLE_PERMISSIONS_MUTATION,
        { id: roleAId, permissions: [Permission.AUDIT_LOG_READ] },
      ).expect(200);
      const body = response.body as {
        data: { updateAdminRolePermissions: { id: string } };
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
    });

    it('ADMIN_USER_UPDATE: rejects an admin downgrading their OWN roleId away from ADMIN_USERS_MANAGE when they are the only ACTIVE holder (not a self-revocation — status is untouched)', async () => {
      const { email, adminUserId } = await seedAdminWithRole(
        'LOCKOUT_SELF_DOWNGRADE_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const { roleId: noManageRoleId } = await seedAdminWithRole(
        'LOCKOUT_SELF_DOWNGRADE_TARGET_ROLE_E2E',
        [Permission.SERVICE_REQUESTS_READ],
      );
      const token = await loginAndGetToken(email);

      await withOnlyTheseAdminsHoldingManage([adminUserId], async () => {
        const response = await adminGraphqlRequest(
          token,
          UPDATE_ADMIN_USER_MUTATION,
          { id: adminUserId, input: { roleId: noManageRoleId } },
        ).expect(200);
        const body = response.body as {
          data: unknown;
          errors?: GraphQLErrorEntry[];
        };
        expect(body.data).toBeNull();
        expect(body.errors?.[0].extensions?.code).toBe(
          'WOULD_LOCK_OUT_ADMIN_MANAGEMENT',
        );
      });
    });

    it('ADMIN_USER_UPDATE: allows the same self role-downgrade when ANOTHER ACTIVE admin still holds ADMIN_USERS_MANAGE', async () => {
      const { email, adminUserId } = await seedAdminWithRole(
        'LOCKOUT_SELF_DOWNGRADE_OK_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      await seedAdminWithRole('LOCKOUT_SELF_DOWNGRADE_OK_OTHER_E2E', [
        Permission.ADMIN_USERS_MANAGE,
      ]);
      const { roleId: noManageRoleId } = await seedAdminWithRole(
        'LOCKOUT_SELF_DOWNGRADE_OK_TARGET_ROLE_E2E',
        [Permission.SERVICE_REQUESTS_READ],
      );
      const token = await loginAndGetToken(email);

      const response = await adminGraphqlRequest(
        token,
        UPDATE_ADMIN_USER_MUTATION,
        { id: adminUserId, input: { roleId: noManageRoleId } },
      ).expect(200);
      const body = response.body as {
        data: { updateAdminUser: { id: string } };
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
      expect(body.data.updateAdminUser.id).toBe(adminUserId);
    });
  });

  describe('self-revocation guard', () => {
    it('rejects an admin revoking their OWN account with CANNOT_REVOKE_OWN_ACCOUNT', async () => {
      const { email, adminUserId } = await seedAdminWithRole(
        'SELF_REVOKE_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const token = await loginAndGetToken(email);

      const response = await adminGraphqlRequest(
        token,
        UPDATE_ADMIN_USER_MUTATION,
        { id: adminUserId, input: { status: 'REVOKED' } },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe(
        'CANNOT_REVOKE_OWN_ACCOUNT',
      );
    });

    it('allows revoking a DIFFERENT admin, and that admin immediately loses access on their next request (existing AdminRbacService behavior, verified via this new mutation)', async () => {
      const { email: actorEmail } = await seedAdminWithRole(
        'REVOKE_OTHER_ACTOR_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const { email: targetEmail, adminUserId: targetId } =
        await seedAdminWithRole('REVOKE_OTHER_TARGET_E2E', [
          Permission.ADMIN_USERS_MANAGE,
        ]);
      const actorToken = await loginAndGetToken(actorEmail);
      const targetToken = await loginAndGetToken(targetEmail);

      const revokeResponse = await adminGraphqlRequest(
        actorToken,
        UPDATE_ADMIN_USER_MUTATION,
        { id: targetId, input: { status: 'REVOKED' } },
      ).expect(200);
      const revokeBody = revokeResponse.body as {
        data: { updateAdminUser: { status: string } };
        errors?: GraphQLErrorEntry[];
      };
      expect(revokeBody.errors).toBeUndefined();
      expect(revokeBody.data.updateAdminUser.status).toBe('REVOKED');

      // The revoked admin's OWN, still-technically-valid session token now
      // gets ADMIN_FORBIDDEN on any Permission-gated operation — status is
      // re-checked on every request (AdminRbacService), not cached at login.
      const nextRequest = await adminGraphqlRequest(
        targetToken,
        ADMIN_ROLES_QUERY,
      ).expect(200);
      const nextBody = nextRequest.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(nextBody.data).toBeNull();
      expect(nextBody.errors?.[0].extensions?.code).toBe('ADMIN_FORBIDDEN');
    });
  });

  describe('adminUsers / updateAdminUser', () => {
    it('lists admin users and applies a partial patch (displayName only), writing an ADMIN_USER_UPDATED AdminAuditLog row', async () => {
      const { email, adminUserId } = await seedAdminWithRole(
        'ADMIN_USERS_PATCH_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const token = await loginAndGetToken(email);

      const listResponse = await adminGraphqlRequest(token, ADMIN_USERS_QUERY, {
        limit: 200,
        offset: 0,
      }).expect(200);
      const listBody = listResponse.body as {
        data: { adminUsers: { items: { id: string }[] } };
        errors?: GraphQLErrorEntry[];
      };
      expect(listBody.errors).toBeUndefined();
      expect(
        listBody.data.adminUsers.items.some((row) => row.id === adminUserId),
      ).toBe(true);

      const updateResponse = await adminGraphqlRequest(
        token,
        UPDATE_ADMIN_USER_MUTATION,
        { id: adminUserId, input: { displayName: 'Updated Display Name' } },
      ).expect(200);
      expect(
        (updateResponse.body as { errors?: GraphQLErrorEntry[] }).errors,
      ).toBeUndefined();

      const auditRows = await prisma.adminAuditLog.findMany({
        where: {
          targetType: 'AdminUser',
          targetKey: adminUserId,
          action: 'ADMIN_USER_UPDATED',
        },
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects setting status: INVITED directly with ADMIN_USER_INVALID_STATUS_TRANSITION', async () => {
      const { email, adminUserId } = await seedAdminWithRole(
        'ADMIN_USERS_INVALID_STATUS_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const token = await loginAndGetToken(email);

      const response = await adminGraphqlRequest(
        token,
        UPDATE_ADMIN_USER_MUTATION,
        { id: adminUserId, input: { status: 'INVITED' } },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe(
        'ADMIN_USER_INVALID_STATUS_TRANSITION',
      );
    });
  });

  describe('deleteAdminUser', () => {
    it('permanently deletes an admin with zero audit history, writing an ADMIN_USER_DELETED row (as the ACTOR, not the deleted target)', async () => {
      const { email: actorEmail } = await seedAdminWithRole(
        'DELETE_ACTOR_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const { adminUserId: targetId } = await seedAdminWithRole(
        'DELETE_TARGET_CLEAN_E2E',
        [Permission.SERVICE_REQUESTS_READ], // never performed any audited action
      );
      const token = await loginAndGetToken(actorEmail);

      const response = await adminGraphqlRequest(
        token,
        DELETE_ADMIN_USER_MUTATION,
        { id: targetId },
      ).expect(200);
      const body = response.body as {
        data: { deleteAdminUser: { success: boolean } };
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
      expect(body.data.deleteAdminUser.success).toBe(true);

      const stillExists = await prisma.adminUser.findUnique({
        where: { id: targetId },
      });
      expect(stillExists).toBeNull();

      const auditRows = await prisma.adminAuditLog.findMany({
        where: { targetType: 'AdminUser', targetKey: targetId },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('ADMIN_USER_DELETED');
      // The actor performing the deletion is recorded, never the (now-gone)
      // deleted target — AdminAuditLog.actorAdminUser is onDelete: Restrict,
      // so this row could not exist at all if it pointed at the deleted row.
      const actor = await prisma.adminUser.findUnique({
        where: { email: actorEmail },
      });
      expect(auditRows[0].actorAdminUserId).toBe(actor?.id);
    });

    it('rejects deleting your OWN account with CANNOT_DELETE_OWN_ACCOUNT', async () => {
      const { email, adminUserId } = await seedAdminWithRole(
        'DELETE_SELF_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const token = await loginAndGetToken(email);

      const response = await adminGraphqlRequest(
        token,
        DELETE_ADMIN_USER_MUTATION,
        { id: adminUserId },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe(
        'CANNOT_DELETE_OWN_ACCOUNT',
      );

      const stillExists = await prisma.adminUser.findUnique({
        where: { id: adminUserId },
      });
      expect(stillExists).not.toBeNull();
    });

    it('rejects deleting an admin who has ever authored an AdminAuditLog row with ADMIN_USER_HAS_AUDIT_HISTORY, suggesting Revoke instead', async () => {
      const { email: actorEmail } = await seedAdminWithRole(
        'DELETE_HISTORY_ACTOR_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const { email: targetEmail, adminUserId: targetId } =
        await seedAdminWithRole('DELETE_HISTORY_TARGET_E2E', [
          Permission.ADMIN_USERS_MANAGE,
        ]);
      const { adminUserId: bystanderId } = await seedAdminWithRole(
        'DELETE_HISTORY_BYSTANDER_E2E',
        [Permission.SERVICE_REQUESTS_READ],
      );
      const actorToken = await loginAndGetToken(actorEmail);
      const targetToken = await loginAndGetToken(targetEmail);

      // The target performs one harmless audited action of their own (a
      // no-op-adjacent displayName patch on a bystander admin) — this is
      // what gives them real audit history as an ACTOR, the exact condition
      // ADMIN_USER_HAS_AUDIT_HISTORY exists to detect.
      const patchResponse = await adminGraphqlRequest(
        targetToken,
        UPDATE_ADMIN_USER_MUTATION,
        { id: bystanderId, input: { displayName: 'Patched By Target' } },
      ).expect(200);
      expect(
        (patchResponse.body as { errors?: GraphQLErrorEntry[] }).errors,
      ).toBeUndefined();

      const response = await adminGraphqlRequest(
        actorToken,
        DELETE_ADMIN_USER_MUTATION,
        { id: targetId },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe(
        'ADMIN_USER_HAS_AUDIT_HISTORY',
      );

      const stillExists = await prisma.adminUser.findUnique({
        where: { id: targetId },
      });
      expect(stillExists).not.toBeNull();
    });

    /**
     * `DeleteAdminUserService` DOES call `AdminLockoutGuardService` (same
     * defense-in-depth reasoning as `UpdateAdminUserService`), and that
     * REJECTING branch is fully proven at the unit level
     * (`delete-admin-user.service.spec.ts`, mocking the guard to reject).
     * It is deliberately NOT exercised here as a real, rejecting e2e case:
     * unlike `updateAdminUser` (which can trigger a genuine lockout via an
     * admin editing their OWN `roleId` — self-editing is allowed there,
     * only self-REVOKE is blocked), `deleteAdminUser` blocks self-deletion
     * UNCONDITIONALLY, and the caller must ALREADY hold `ADMIN_USERS_MANAGE`
     * to pass `AdminPermissionsGuard` just to invoke this mutation at all —
     * so the calling admin themselves is always still an ACTIVE holder
     * immediately after deleting any DIFFERENT target, structurally
     * guaranteeing at least one holder remains. The rejecting branch is
     * real, deliberate defense-in-depth (e.g. against a future change that
     * allows bulk-delete, or a race), not something reachable through
     * today's actual API surface — flagged explicitly rather than
     * constructing an artificial scenario that doesn't reflect real usage.
     */
    it('allows deleting a target who DOES hold ADMIN_USERS_MANAGE, since the calling admin (who must also hold it) remains', async () => {
      const { email: actorEmail, adminUserId: actorId } =
        await seedAdminWithRole('DELETE_MANAGE_ACTOR_E2E', [
          Permission.ADMIN_USERS_MANAGE,
        ]);
      const { adminUserId: targetId } = await seedAdminWithRole(
        'DELETE_MANAGE_TARGET_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const token = await loginAndGetToken(actorEmail);

      await withOnlyTheseAdminsHoldingManage([actorId, targetId], async () => {
        const response = await adminGraphqlRequest(
          token,
          DELETE_ADMIN_USER_MUTATION,
          { id: targetId },
        ).expect(200);
        const body = response.body as {
          data: { deleteAdminUser: { success: boolean } };
          errors?: GraphQLErrorEntry[];
        };
        expect(body.errors).toBeUndefined();
        expect(body.data.deleteAdminUser.success).toBe(true);
      });
    });
  });

  describe('inviteAdminUser / resendAdminInvite / acceptAdminInvite', () => {
    it('full flow: invite -> seed a known raw token over the real created AdminInvite row -> accept -> adminLogin -> adminMe', async () => {
      const { email: actorEmail, roleId: targetRoleId } =
        await seedAdminWithRole('INVITE_FLOW_ACTOR_E2E', [
          Permission.ADMIN_USERS_MANAGE,
        ]);
      const actorToken = await loginAndGetToken(actorEmail);
      const inviteeEmail = uniqueEmail('invitee');

      const inviteResponse = await adminGraphqlRequest(
        actorToken,
        INVITE_ADMIN_USER_MUTATION,
        {
          input: {
            email: inviteeEmail,
            displayName: 'Invited Admin',
            roleId: targetRoleId,
          },
        },
      ).expect(200);
      const inviteBody = inviteResponse.body as {
        data: { inviteAdminUser: { id: string; status: string } };
        errors?: GraphQLErrorEntry[];
      };
      expect(inviteBody.errors).toBeUndefined();
      expect(inviteBody.data.inviteAdminUser.status).toBe('INVITED');
      const invitedAdminUserId = inviteBody.data.inviteAdminUser.id;

      // The real `AdminInvite` row now exists (created by `inviteAdminUser`
      // for real), but its raw token was only ever emailed — never returned
      // over GraphQL or persisted anywhere in plaintext. Per this feature's
      // own e2e-testing convention (mirrors
      // `test/users-verify-email-code.e2e-spec.ts`'s seeded-code pattern,
      // NOT a BullMQ-job-inspection mechanism, which doesn't exist anywhere
      // in this codebase): read back the real row this mutation created,
      // then overwrite its `tokenHash` to one THIS TEST controls, hashed
      // with the exact same util the real service uses.
      const realInvite = await prisma.adminInvite.findFirst({
        where: { adminUserId: invitedAdminUserId },
        orderBy: { createdAt: 'desc' },
      });
      expect(realInvite).not.toBeNull();
      const KNOWN_RAW_TOKEN = `e2e-known-token-${invitedAdminUserId}`;
      await prisma.adminInvite.update({
        where: { id: realInvite!.id },
        data: { tokenHash: hashAdminInviteToken(KNOWN_RAW_TOKEN) },
      });

      const NEW_PASSWORD = 'a-brand-new-strong-password-1';
      const acceptResponse = await adminGraphqlRequest(
        null,
        ACCEPT_ADMIN_INVITE_MUTATION,
        { input: { token: KNOWN_RAW_TOKEN, newPassword: NEW_PASSWORD } },
      ).expect(200);
      const acceptBody = acceptResponse.body as {
        data: {
          acceptAdminInvite: { success: boolean; errors: unknown[] };
        };
        errors?: GraphQLErrorEntry[];
      };
      expect(acceptBody.errors).toBeUndefined();
      expect(acceptBody.data.acceptAdminInvite).toEqual({
        success: true,
        errors: [],
      });

      const loginResponse = await request(app.getHttpServer())
        .post('/admin/graphql')
        .send({
          query: ADMIN_LOGIN_MUTATION,
          variables: { input: { email: inviteeEmail, password: NEW_PASSWORD } },
        })
        .expect(200);
      const loginBody = loginResponse.body as {
        data: { adminLogin: { sessionToken: string } };
        errors?: GraphQLErrorEntry[];
      };
      expect(loginBody.errors).toBeUndefined();
      const newAdminToken = loginBody.data.adminLogin.sessionToken;

      const meResponse = await adminGraphqlRequest(
        newAdminToken,
        ADMIN_ME_QUERY,
      ).expect(200);
      const meBody = meResponse.body as { data: { adminMe: string } };
      expect(meBody.data.adminMe).toBe(invitedAdminUserId);
    });

    it('acceptAdminInvite collapses EVERY invalid case (nonexistent, expired, already consumed) into the SAME generic ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED result', async () => {
      const nonexistentResponse = await adminGraphqlRequest(
        null,
        ACCEPT_ADMIN_INVITE_MUTATION,
        {
          input: {
            token: 'this-token-was-never-issued',
            newPassword: 'a-strong-password-1',
          },
        },
      ).expect(200);
      const nonexistentBody = nonexistentResponse.body as {
        data: {
          acceptAdminInvite: { success: boolean; errors: { code: string }[] };
        };
      };
      expect(nonexistentBody.data.acceptAdminInvite.success).toBe(false);
      expect(nonexistentBody.data.acceptAdminInvite.errors[0].code).toBe(
        'ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED',
      );

      const { roleId } = await seedAdminWithRole('INVITE_EXPIRED_ROLE_E2E', [
        Permission.SERVICE_REQUESTS_READ,
      ]);
      const expiredAdmin = await prisma.adminUser.create({
        data: {
          email: uniqueEmail('expired-invitee'),
          displayName: 'Expired Invitee',
          roleId,
          status: AdminUserStatus.INVITED,
        },
      });
      const EXPIRED_TOKEN = `e2e-expired-token-${expiredAdmin.id}`;
      await prisma.adminInvite.create({
        data: {
          adminUserId: expiredAdmin.id,
          tokenHash: hashAdminInviteToken(EXPIRED_TOKEN),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const expiredResponse = await adminGraphqlRequest(
        null,
        ACCEPT_ADMIN_INVITE_MUTATION,
        {
          input: { token: EXPIRED_TOKEN, newPassword: 'a-strong-password-1' },
        },
      ).expect(200);
      const expiredBody = expiredResponse.body as {
        data: {
          acceptAdminInvite: { success: boolean; errors: { code: string }[] };
        };
      };
      expect(expiredBody.data.acceptAdminInvite.success).toBe(false);
      expect(expiredBody.data.acceptAdminInvite.errors[0].code).toBe(
        'ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED',
      );
    });

    it('resendAdminInvite is a no-op (success: false, no new AdminAuditLog row) when called again immediately, still within the resend cooldown', async () => {
      const { email: actorEmail, roleId } = await seedAdminWithRole(
        'RESEND_COOLDOWN_ACTOR_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const actorToken = await loginAndGetToken(actorEmail);

      const inviteResponse = await adminGraphqlRequest(
        actorToken,
        INVITE_ADMIN_USER_MUTATION,
        {
          input: {
            email: uniqueEmail('resend-invitee'),
            displayName: 'Resend Invitee',
            roleId,
          },
        },
      ).expect(200);
      const invitedAdminUserId = (
        inviteResponse.body as { data: { inviteAdminUser: { id: string } } }
      ).data.inviteAdminUser.id;

      const resendResponse = await adminGraphqlRequest(
        actorToken,
        RESEND_ADMIN_INVITE_MUTATION,
        { adminUserId: invitedAdminUserId },
      ).expect(200);
      const resendBody = resendResponse.body as {
        data: { resendAdminInvite: { success: boolean } };
        errors?: GraphQLErrorEntry[];
      };
      expect(resendBody.errors).toBeUndefined();
      expect(resendBody.data.resendAdminInvite.success).toBe(false);

      const resentAuditRows = await prisma.adminAuditLog.findMany({
        where: {
          targetType: 'AdminUser',
          targetKey: invitedAdminUserId,
          action: 'ADMIN_USER_INVITE_RESENT',
        },
      });
      expect(resentAuditRows).toHaveLength(0);
    });

    it('resendAdminInvite rejects an admin who is not currently INVITED (already ACTIVE) with ADMIN_USER_NOT_INVITED', async () => {
      const { email: actorEmail } = await seedAdminWithRole(
        'RESEND_NOT_INVITED_ACTOR_E2E',
        [Permission.ADMIN_USERS_MANAGE],
      );
      const { adminUserId: activeAdminId } = await seedAdminWithRole(
        'RESEND_NOT_INVITED_TARGET_E2E',
        [Permission.SERVICE_REQUESTS_READ],
      );
      const actorToken = await loginAndGetToken(actorEmail);

      const response = await adminGraphqlRequest(
        actorToken,
        RESEND_ADMIN_INVITE_MUTATION,
        { adminUserId: activeAdminId },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('ADMIN_USER_NOT_INVITED');
    });
  });

  describe('permission gating', () => {
    it('a SUPPORT_VIEWER-shaped role (no ADMIN_USERS_MANAGE) gets ADMIN_FORBIDDEN on every operation in this feature', async () => {
      const { email } = await seedAdminWithRole('NO_MANAGE_E2E', [
        Permission.FEATURE_FLAGS_READ,
      ]);
      const token = await loginAndGetToken(email);

      const attempts: [string, unknown][] = [
        [ADMIN_ROLES_QUERY, undefined],
        [
          CREATE_ADMIN_ROLE_MUTATION,
          { input: { name: 'SHOULD_NOT_BE_CREATED', permissions: [] } },
        ],
        [ADMIN_USERS_QUERY, { limit: 10, offset: 0 }],
        [
          INVITE_ADMIN_USER_MUTATION,
          {
            input: {
              email: uniqueEmail('should-not-be-invited'),
              displayName: 'Nope',
              roleId: '00000000-0000-0000-0000-000000000000',
            },
          },
        ],
      ];

      for (const [query, variables] of attempts) {
        const response = await adminGraphqlRequest(
          token,
          query,
          variables,
        ).expect(200);
        const body = response.body as {
          data: unknown;
          errors?: GraphQLErrorEntry[];
        };
        expect(body.data).toBeNull();
        expect(body.errors?.[0].extensions?.code).toBe('ADMIN_FORBIDDEN');
      }
    });
  });
});
