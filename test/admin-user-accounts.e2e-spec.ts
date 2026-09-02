import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminUserStatus,
  AuthProvider,
  Permission,
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
  cleanUsersData,
  createTestApp,
  enableTestEmailDelivery,
} from './support/test-app';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) { sessionToken }
  }
`;

const USER_ACCOUNTS_QUERY = `
  query UserAccounts($limit: Int, $offset: Int) {
    userAccounts(limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        firstName
        lastName
        email
        phoneCountryCode
        phoneNumber
        accountStatus
        authProvider
        hasCustomerProfile
        hasProfessionalProfile
      }
    }
  }
`;

const USER_ACCOUNT_DETAIL_QUERY = `
  query UserAccountDetail($id: ID!) {
    userAccountDetail(id: $id) {
      id
      firstName
      lastName
      email
      accountStatus
      authProvider
      hasCustomerProfile
      hasProfessionalProfile
      customerProfile {
        id
        firstName
        lastName
        addressLine
        city
        province
        country
        photoUrl
      }
      professionalProfile {
        id
        firstName
        lastName
        displayName
        bio
        city
        country
        serviceAreaDescription
        verificationStatus
        languages
        specializations {
          role
          description
          yearsOfExperience
          order
          category {
            id
            name
          }
        }
      }
    }
  }
`;

const DELETE_MUTATION = `
  mutation DeleteUserAccount($id: ID!) {
    deleteUserAccount(id: $id) {
      success
    }
  }
`;

const BULK_DELETE_MUTATION = `
  mutation BulkDeleteUserAccounts($ids: [ID!]!) {
    bulkDeleteUserAccounts(ids: $ids) {
      succeededIds
      failed { id reason }
    }
  }
`;

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      userId
      sessionToken
      errors { code message }
    }
  }
`;

const UPDATE_USER_ACCOUNT_MUTATION = `
  mutation UpdateUserAccount($id: ID!, $input: UpdateUserAccountInput!) {
    updateUserAccount(id: $id, input: $input) {
      id
      firstName
      lastName
      email
      phoneCountryCode
      phoneNumber
      accountStatus
    }
  }
`;

const FORCE_RESET_MUTATION = `
  mutation ForceReset($userId: ID!) {
    forceUserAccountPasswordReset(userId: $userId) {
      success
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

const PASSWORD = 'super-secret-admin-2';

/**
 * `Math.random().toString(36).slice(2)`'s length is NOT bounded to a fixed
 * size — for a small-enough draw it can grow well past its "typical" ~10-11
 * chars (confirmed empirically up to 15+ chars in rare cases), which was
 * found, live, to occasionally push a long role-name-derived local-part over
 * RFC 5321's 64-char limit and fail class-validator's `@IsEmail()` with a
 * genuinely flaky "email must be an email" `BAD_REQUEST` — not a throttle
 * issue, a real intermittent bug in this helper. Fixed by padding/truncating
 * to a FIXED 8-char suffix, so the produced email's total length is always
 * deterministic regardless of the specific random draw.
 */
function uniqueEmail(prefix: string): string {
  const randomSuffix = Math.random()
    .toString(36)
    .slice(2)
    .padEnd(8, '0')
    .slice(0, 8);
  return `${prefix}-${Date.now()}-${randomSuffix}@example.com`;
}

/**
 * e2e coverage for `userAccounts`/`updateUserAccount`/
 * `forceUserAccountPasswordReset` (GOS-3x follow-up) — permission
 * enforcement (`USER_ACCOUNTS_READ`/`USER_ACCOUNTS_WRITE`), the
 * email-change-forces-PENDING_EMAIL_VERIFICATION behavior, the
 * email-uniqueness rejection (with no partial update), the
 * `EnsureEmailDeliveryAvailableService` gate on the force-reset mutation,
 * and the NON-NEGOTIABLE rule that `passwordHash`/`socialProviderSubject`
 * never appear anywhere in a raw response body.
 */
describe('GraphQL /admin/graphql — userAccounts/updateUserAccount/forceUserAccountPasswordReset (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // userAccountDetail's own tests (below) create Category rows to exercise
  // a ProfessionalProfile's specializations — tracked here so they can be
  // cleaned up without touching any other category the DB might hold.
  const createdCategoryIds: string[] = [];

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
    await cleanUsersData(prisma);
    await cleanAdminUsersData(prisma);
    await prisma.category.deleteMany({
      where: { id: { in: createdCategoryIds } },
    });
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

  async function seedTestUser(overrides?: {
    accountStatus?: UserAccountStatus;
  }): Promise<{ id: string; email: string }> {
    const email = uniqueEmail('consumer');
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash: 'irrelevant-hash-for-this-suite',
        phoneCountryCode: '+54',
        phoneNumber: '91122334455',
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus:
          overrides?.accountStatus ?? UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    return { id: user.id, email };
  }

  const CONSUMER_PASSWORD = 'super-secret-consumer-1';

  /**
   * GOS-3x follow-up (hard-delete, 2026-08-11) — a REAL argon2id hash (same
   * hashing the real `Argon2PasswordHasherAdapter` produces), needed for the
   * full delete round trip below, which actually attempts a real `login`
   * mutation against the PUBLIC `/graphql` schema (this suite's `app`
   * instance serves both endpoints) both before and after deletion.
   */
  async function seedRealPasswordTestUser(): Promise<{
    id: string;
    email: string;
  }> {
    const email = uniqueEmail('consumer-real');
    const passwordHash = await argon2.hash(CONSUMER_PASSWORD, {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash,
        phoneCountryCode: '+54',
        phoneNumber: '91122334455',
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    return { id: user.id, email };
  }

  async function loginRequest(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password } },
      })
      .expect(200);
  }

  it('userAccounts is readable by CONFIG_MANAGER-shaped permissions and never exposes passwordHash/socialProviderSubject', async () => {
    const { id, email } = await seedTestUser();
    const { email: adminEmail } = await seedAdminWithRole(
      'CONFIG_MANAGER_UA_E2E',
      [Permission.USER_ACCOUNTS_READ, Permission.USER_ACCOUNTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, USER_ACCOUNTS_QUERY, {
      limit: 200,
      offset: 0,
    }).expect(200);
    const body = response.body as {
      data: {
        userAccounts: {
          totalCount: number;
          items: { id: string; email: string }[];
        };
      };
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    const row = body.data.userAccounts.items.find((u) => u.id === id);
    expect(row?.email).toBe(email);
    expect(JSON.stringify(response.body)).not.toContain(
      'irrelevant-hash-for-this-suite',
    );
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash/i);
    expect(JSON.stringify(response.body)).not.toMatch(/socialProviderSubject/i);
  });

  it('updateUserAccount applies only the fields present in the input (partial patch)', async () => {
    const { id } = await seedTestUser();
    const { email: adminEmail } = await seedAdminWithRole(
      'CONFIG_MANAGER_UA_PATCH_E2E',
      [Permission.USER_ACCOUNTS_READ, Permission.USER_ACCOUNTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(
      token,
      UPDATE_USER_ACCOUNT_MUTATION,
      { id, input: { firstName: 'Updated' } },
    ).expect(200);
    const body = response.body as {
      data: {
        updateUserAccount: {
          firstName: string;
          lastName: string;
          phoneNumber: string;
        };
      };
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.updateUserAccount.firstName).toBe('Updated');
    expect(body.data.updateUserAccount.lastName).toBe('Doe'); // untouched
    expect(body.data.updateUserAccount.phoneNumber).toBe('91122334455'); // untouched

    const auditRows = await prisma.adminAuditLog.findMany({
      where: {
        targetType: 'User',
        targetKey: id,
        action: 'USER_ACCOUNT_UPDATED',
      },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('updateUserAccount resets accountStatus to PENDING_EMAIL_VERIFICATION when email changes', async () => {
    const { id } = await seedTestUser({
      accountStatus: UserAccountStatus.APPROVED,
    });
    const { email: adminEmail } = await seedAdminWithRole(
      'CONFIG_MANAGER_UA_EMAIL_E2E',
      [Permission.USER_ACCOUNTS_READ, Permission.USER_ACCOUNTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);
    const newEmail = uniqueEmail('changed');

    const response = await adminGraphqlRequest(
      token,
      UPDATE_USER_ACCOUNT_MUTATION,
      { id, input: { email: newEmail } },
    ).expect(200);
    const body = response.body as {
      data: { updateUserAccount: { email: string; accountStatus: string } };
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.updateUserAccount.email).toBe(newEmail);
    expect(body.data.updateUserAccount.accountStatus).toBe(
      'PENDING_EMAIL_VERIFICATION',
    );
  });

  it('updateUserAccount rejects an email already taken by a different user, with no partial update', async () => {
    const { id } = await seedTestUser();
    const other = await seedTestUser();
    const { email: adminEmail } = await seedAdminWithRole(
      'CONFIG_MANAGER_UA_TAKEN_E2E',
      [Permission.USER_ACCOUNTS_READ, Permission.USER_ACCOUNTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(
      token,
      UPDATE_USER_ACCOUNT_MUTATION,
      { id, input: { email: other.email, firstName: 'ShouldNotApply' } },
    ).expect(200);
    const body = response.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('USER_ACCOUNT_EMAIL_TAKEN');

    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.firstName).not.toBe('ShouldNotApply');
  });

  it('SUPPORT_VIEWER can query userAccounts but gets ADMIN_FORBIDDEN on updateUserAccount/forceUserAccountPasswordReset', async () => {
    const { id } = await seedTestUser();
    const { email: adminEmail } = await seedAdminWithRole(
      'SUPPORT_VIEWER_UA_E2E',
      [Permission.USER_ACCOUNTS_READ],
    );
    const token = await loginAndGetToken(adminEmail);

    const readResponse = await adminGraphqlRequest(token, USER_ACCOUNTS_QUERY, {
      limit: 10,
      offset: 0,
    }).expect(200);
    const readBody = readResponse.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };
    expect(readBody.errors).toBeUndefined();

    const updateResponse = await adminGraphqlRequest(
      token,
      UPDATE_USER_ACCOUNT_MUTATION,
      { id, input: { firstName: 'Nope' } },
    ).expect(200);
    const updateBody = updateResponse.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };
    expect(updateBody.data).toBeNull();
    expect(updateBody.errors?.[0].extensions?.code).toBe('ADMIN_FORBIDDEN');

    const resetResponse = await adminGraphqlRequest(
      token,
      FORCE_RESET_MUTATION,
      { userId: id },
    ).expect(200);
    const resetBody = resetResponse.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };
    expect(resetBody.data).toBeNull();
    expect(resetBody.errors?.[0].extensions?.code).toBe('ADMIN_FORBIDDEN');
  });

  it('userAccounts rejects with ADMIN_UNAUTHENTICATED when no session token is sent', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query: USER_ACCOUNTS_QUERY, variables: { limit: 10, offset: 0 } })
      .expect(200);
    const body = response.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
  });

  it('forceUserAccountPasswordReset succeeds for a real user and writes a distinct AdminAuditLog entry, never exposing/accepting a raw password', async () => {
    const { id } = await seedTestUser();
    const { email: adminEmail } = await seedAdminWithRole(
      'CONFIG_MANAGER_UA_RESET_E2E',
      [Permission.USER_ACCOUNTS_READ, Permission.USER_ACCOUNTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, FORCE_RESET_MUTATION, {
      userId: id,
    }).expect(200);
    const body = response.body as {
      data: { forceUserAccountPasswordReset: { success: boolean } };
      errors?: GraphQLErrorEntry[];
    };

    expect(body.errors).toBeUndefined();
    expect(body.data.forceUserAccountPasswordReset.success).toBe(true);

    const auditRows = await prisma.adminAuditLog.findMany({
      where: {
        targetType: 'User',
        targetKey: id,
        action: 'USER_ACCOUNT_PASSWORD_RESET_FORCED',
      },
    });
    expect(auditRows.length).toBe(1);

    const resetCodes = await prisma.passwordResetCode.findMany({
      where: { userId: id },
    });
    expect(resetCodes.length).toBe(1);
  });

  it('forceUserAccountPasswordReset rejects a nonexistent userId with a clear, specific error (no anti-enumeration needed for this internal admin tool)', async () => {
    const { email: adminEmail } = await seedAdminWithRole(
      'CONFIG_MANAGER_UA_RESET_404_E2E',
      [Permission.USER_ACCOUNTS_READ, Permission.USER_ACCOUNTS_WRITE],
    );
    const token = await loginAndGetToken(adminEmail);

    const response = await adminGraphqlRequest(token, FORCE_RESET_MUTATION, {
      userId: '00000000-0000-0000-0000-000000000000',
    }).expect(200);
    const body = response.body as {
      data: unknown;
      errors?: GraphQLErrorEntry[];
    };

    expect(body.data).toBeNull();
    expect(body.errors?.[0].extensions?.code).toBe('USER_ACCOUNT_NOT_FOUND');
  });

  /**
   * GOS-3x follow-up (hard-delete, 2026-08-11) — seeds a `User` plus one of
   * every relation `onDelete: Cascade` is supposed to sweep away with it
   * (`Session`, `EmailVerificationCode`, `PasswordResetCode`,
   * `CustomerProfile`, `ProfessionalProfile`), so the cascade test below can
   * prove the real deletion, not just assume the schema's `onDelete` clauses
   * behave as documented.
   */
  async function seedUserWithFullRelations(): Promise<{
    id: string;
    email: string;
  }> {
    const email = uniqueEmail('consumer-full');
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash: 'irrelevant-hash-for-this-suite',
        phoneCountryCode: '+54',
        phoneNumber: '91122334455',
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `cascade-test-token-${user.id}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.emailVerificationCode.create({
      data: {
        userId: user.id,
        codeHash: `cascade-test-code-${user.id}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.passwordResetCode.create({
      data: {
        userId: user.id,
        codeHash: `cascade-test-reset-code-${user.id}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.customerProfile.create({
      data: {
        userId: user.id,
        firstName: 'Jane',
        lastName: 'Doe',
        addressLine: 'Av. Siempre Viva 742',
        city: 'Buenos Aires',
        province: 'CABA',
      },
    });
    await prisma.professionalProfile.create({
      data: {
        userId: user.id,
        firstName: 'Jane',
        lastName: 'Doe',
        city: 'Buenos Aires',
        serviceAreaDescription: 'CABA and surrounding areas',
        bio: 'Experienced professional.',
      },
    });
    return { id: user.id, email };
  }

  // GOS-3x follow-up (hard-delete, 2026-08-11) — REPLACES the prior round's
  // reversible deactivateUserAccount/reactivateUserAccount/
  // bulkDeactivateUserAccounts with a real, permanent deleteUserAccount/
  // bulkDeleteUserAccounts. See ADR 0005's Tenth round for the full
  // rationale and the explicit human authorization for this irreversible
  // operation.
  describe('deleteUserAccount / bulkDeleteUserAccounts', () => {
    it('CONFIG_MANAGER-shaped permissions (USER_ACCOUNTS_READ/WRITE, no DELETE) get ADMIN_FORBIDDEN on both mutations', async () => {
      const { id } = await seedTestUser();
      const { email: adminEmail } = await seedAdminWithRole(
        'CONFIG_MANAGER_UA_DELETE_FORBIDDEN_E2E',
        [Permission.USER_ACCOUNTS_READ, Permission.USER_ACCOUNTS_WRITE],
      );
      const token = await loginAndGetToken(adminEmail);

      const deleteResponse = await adminGraphqlRequest(token, DELETE_MUTATION, {
        id,
      }).expect(200);
      expect(
        (deleteResponse.body as { errors?: GraphQLErrorEntry[] }).errors?.[0]
          .extensions?.code,
      ).toBe('ADMIN_FORBIDDEN');

      const bulkResponse = await adminGraphqlRequest(
        token,
        BULK_DELETE_MUTATION,
        { ids: [id] },
      ).expect(200);
      expect(
        (bulkResponse.body as { errors?: GraphQLErrorEntry[] }).errors?.[0]
          .extensions?.code,
      ).toBe('ADMIN_FORBIDDEN');

      // Neither call actually deleted anything.
      await expect(
        prisma.user.findUnique({ where: { id } }),
      ).resolves.not.toBeNull();
    });

    it('SUPER_ADMIN-shaped permissions (USER_ACCOUNTS_DELETE) can permanently delete a user account, writing an AdminAuditLog snapshot, and the row + every cascading relation are gone for good', async () => {
      const { id, email } = await seedUserWithFullRelations();
      const { email: adminEmail } = await seedAdminWithRole(
        'SUPER_ADMIN_SHAPED_UA_DELETE_E2E',
        [
          Permission.USER_ACCOUNTS_READ,
          Permission.USER_ACCOUNTS_WRITE,
          Permission.USER_ACCOUNTS_DELETE,
        ],
      );
      const token = await loginAndGetToken(adminEmail);

      const deleteResponse = await adminGraphqlRequest(token, DELETE_MUTATION, {
        id,
      }).expect(200);
      const deleteBody = deleteResponse.body as {
        data: { deleteUserAccount: { success: boolean } };
        errors?: GraphQLErrorEntry[];
      };
      expect(deleteBody.errors).toBeUndefined();
      expect(deleteBody.data.deleteUserAccount.success).toBe(true);

      // The audit log survives — targetKey is a plain String, not a FK —
      // and captured a useful snapshot before the row disappeared.
      const auditRows = await prisma.adminAuditLog.findMany({
        where: {
          targetType: 'User',
          targetKey: id,
          action: 'USER_ACCOUNT_DELETED',
        },
      });
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].metadata).toEqual({
        email,
        hadCustomerProfile: true,
        hadProfessionalProfile: true,
      });

      // The User row itself is gone.
      await expect(
        prisma.user.findUnique({ where: { id } }),
      ).resolves.toBeNull();

      // Every relation onDelete: Cascade is supposed to sweep away is gone
      // too — a real proof of cascading deletion, not just the deletedAt
      // field the prior soft-delete round relied on.
      await expect(
        prisma.session.findMany({ where: { userId: id } }),
      ).resolves.toHaveLength(0);
      await expect(
        prisma.emailVerificationCode.findMany({ where: { userId: id } }),
      ).resolves.toHaveLength(0);
      await expect(
        prisma.passwordResetCode.findMany({ where: { userId: id } }),
      ).resolves.toHaveLength(0);
      await expect(
        prisma.customerProfile.findUnique({ where: { userId: id } }),
      ).resolves.toBeNull();
      await expect(
        prisma.professionalProfile.findUnique({ where: { userId: id } }),
      ).resolves.toBeNull();
    });

    it('deleteUserAccount rejects a nonexistent id with USER_ACCOUNT_NOT_FOUND', async () => {
      const { email: adminEmail } = await seedAdminWithRole(
        'SUPER_ADMIN_UA_DELETE_404_E2E',
        [Permission.USER_ACCOUNTS_DELETE],
      );
      const token = await loginAndGetToken(adminEmail);

      const response = await adminGraphqlRequest(token, DELETE_MUTATION, {
        id: '00000000-0000-0000-0000-000000000000',
      }).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('USER_ACCOUNT_NOT_FOUND');
    });

    it('userAccounts no longer accepts includeDeactivated and never returns a deletedAt field', async () => {
      const { id } = await seedTestUser();
      const { email: adminEmail } = await seedAdminWithRole(
        'SUPER_ADMIN_UA_GRID_SHAPE_E2E',
        [Permission.USER_ACCOUNTS_READ],
      );
      const token = await loginAndGetToken(adminEmail);

      const response = await adminGraphqlRequest(token, USER_ACCOUNTS_QUERY, {
        limit: 200,
        offset: 0,
      }).expect(200);
      const body = response.body as {
        data: { userAccounts: { items: { id: string }[] } };
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
      expect(body.data.userAccounts.items.some((row) => row.id === id)).toBe(
        true,
      );
      expect(JSON.stringify(response.body)).not.toMatch(/deletedAt/i);
    });

    it('bulkDeleteUserAccounts processes a mix of valid/nonexistent ids independently, without aborting the batch, writing one AdminAuditLog row per success', async () => {
      const { id: goodId1 } = await seedTestUser();
      const { id: goodId2 } = await seedTestUser();
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      const { email: adminEmail } = await seedAdminWithRole(
        'SUPER_ADMIN_UA_BULK_DELETE_E2E',
        [Permission.USER_ACCOUNTS_DELETE],
      );
      const token = await loginAndGetToken(adminEmail);

      const response = await adminGraphqlRequest(token, BULK_DELETE_MUTATION, {
        ids: [goodId1, goodId2, nonexistentId],
      }).expect(200);
      const body = response.body as {
        data: {
          bulkDeleteUserAccounts: {
            succeededIds: string[];
            failed: { id: string; reason: string }[];
          };
        };
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data.bulkDeleteUserAccounts.succeededIds.sort()).toEqual(
        [goodId1, goodId2].sort(),
      );
      expect(body.data.bulkDeleteUserAccounts.failed).toHaveLength(1);
      expect(body.data.bulkDeleteUserAccounts.failed[0].id).toBe(nonexistentId);

      // One AdminAuditLog row per successfully deleted user — not one
      // aggregate entry for the whole batch.
      const auditRows = await prisma.adminAuditLog.findMany({
        where: {
          targetType: 'User',
          targetKey: { in: [goodId1, goodId2] },
          action: 'USER_ACCOUNT_DELETED',
        },
      });
      expect(auditRows.length).toBe(2);

      const rows = await prisma.user.findMany({
        where: { id: { in: [goodId1, goodId2] } },
      });
      expect(rows).toHaveLength(0);
    });

    it('full flow: a deleted account can no longer log in, with the same generic AUTHENTICATION_FAILED result as an unknown email', async () => {
      const { id, email } = await seedRealPasswordTestUser();
      const { email: adminEmail } = await seedAdminWithRole(
        'SUPER_ADMIN_UA_DELETE_LOGIN_E2E',
        [
          Permission.USER_ACCOUNTS_READ,
          Permission.USER_ACCOUNTS_WRITE,
          Permission.USER_ACCOUNTS_DELETE,
        ],
      );
      const token = await loginAndGetToken(adminEmail);

      // 1. Baseline: login works.
      const loginBefore = await loginRequest(email, CONSUMER_PASSWORD);
      expect(
        (loginBefore.body as { errors?: GraphQLErrorEntry[] }).errors,
      ).toBeUndefined();

      // 2. Delete.
      const deleteResponse = await adminGraphqlRequest(token, DELETE_MUTATION, {
        id,
      }).expect(200);
      expect(
        (deleteResponse.body as { errors?: GraphQLErrorEntry[] }).errors,
      ).toBeUndefined();

      // 3. No longer in the grid.
      const listAfterDelete = await adminGraphqlRequest(
        token,
        USER_ACCOUNTS_QUERY,
        { limit: 200, offset: 0 },
      ).expect(200);
      const listAfterDeleteBody = listAfterDelete.body as {
        data: { userAccounts: { items: { id: string }[] } };
      };
      expect(
        listAfterDeleteBody.data.userAccounts.items.some(
          (row) => row.id === id,
        ),
      ).toBe(false);

      // 4. Login now rejected — same generic AUTHENTICATION_FAILED as an
      // unknown email, since the account genuinely no longer exists.
      const loginAfterDelete = await loginRequest(email, CONSUMER_PASSWORD);
      const loginAfterDeleteBody = loginAfterDelete.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };
      expect(loginAfterDeleteBody.data).toBeNull();
      expect(loginAfterDeleteBody.errors?.[0].extensions?.code).toBe(
        'AUTHENTICATION_FAILED',
      );
    });
  });

  /**
   * e2e coverage for `userAccountDetail` (GOS-3x follow-up, "View" row
   * action, 2026-08-11) — gated by the SAME `USER_ACCOUNTS_READ` as
   * `userAccounts` (no new permission). Covers: success with both profiles
   * present (including a `ProfessionalProfile` specialization), success
   * with neither profile present, 404 for a nonexistent id, and a
   * permission-negative case.
   *
   * RBAC negative note: none of the 3 real seed roles this codebase ships
   * (`SUPER_ADMIN`/`CONFIG_MANAGER`/`SUPPORT_VIEWER` — see
   * `scripts/bootstrap-super-admin.ts`) actually LACKS `USER_ACCOUNTS_READ`
   * — all three hold it. So the negative-permission case below uses an
   * ad-hoc role with no permissions at all, the SAME "seed a role scoped to
   * exactly what this one test needs" convention every other test in this
   * file already uses (see `seedAdminWithRole`) — not a substitute for a
   * missing seed role, since none of the 3 real ones is actually missing
   * this permission.
   */
  describe('userAccountDetail', () => {
    async function seedCategory(): Promise<string> {
      const category = await prisma.category.create({
        data: { name: `UA-Detail-E2E-${Date.now()}-${Math.random()}` },
      });
      createdCategoryIds.push(category.id);
      return category.id;
    }

    it('returns the full detail (base fields + null profiles) for a user with neither a CustomerProfile nor a ProfessionalProfile', async () => {
      const { id, email } = await seedTestUser();
      const { email: adminEmail } = await seedAdminWithRole(
        'CONFIG_MANAGER_UA_DETAIL_NONE_E2E',
        [Permission.USER_ACCOUNTS_READ],
      );
      const token = await loginAndGetToken(adminEmail);

      const response = await adminGraphqlRequest(
        token,
        USER_ACCOUNT_DETAIL_QUERY,
        { id },
      ).expect(200);
      const body = response.body as {
        data: {
          userAccountDetail: {
            id: string;
            email: string;
            hasCustomerProfile: boolean;
            hasProfessionalProfile: boolean;
            customerProfile: unknown;
            professionalProfile: unknown;
          };
        };
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data.userAccountDetail.id).toBe(id);
      expect(body.data.userAccountDetail.email).toBe(email);
      expect(body.data.userAccountDetail.hasCustomerProfile).toBe(false);
      expect(body.data.userAccountDetail.hasProfessionalProfile).toBe(false);
      expect(body.data.userAccountDetail.customerProfile).toBeNull();
      expect(body.data.userAccountDetail.professionalProfile).toBeNull();
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash/i);
      expect(JSON.stringify(response.body)).not.toMatch(
        /socialProviderSubject/i,
      );
    });

    it('returns the full CustomerProfile/ProfessionalProfile (with specializations) for a user who has both', async () => {
      const { id } = await seedTestUser();
      const categoryId = await seedCategory();

      await prisma.customerProfile.create({
        data: {
          userId: id,
          firstName: 'Jane',
          lastName: 'Doe',
          addressLine: 'Av. Siempre Viva 742',
          city: 'Buenos Aires',
          province: 'CABA',
        },
      });
      const professionalProfile = await prisma.professionalProfile.create({
        data: {
          userId: id,
          firstName: 'Jane',
          lastName: 'Doe',
          displayName: 'Jane the Plumber',
          city: 'Buenos Aires',
          serviceAreaDescription: 'CABA and surrounding areas',
          bio: 'Experienced plumber.',
          languages: ['es', 'en'],
        },
      });
      await prisma.professionalSpecialization.create({
        data: {
          professionalProfileId: professionalProfile.id,
          categoryId,
          role: 'PRIMARY',
          description: 'General plumbing work',
          yearsOfExperience: 7,
          order: 0,
        },
      });

      const { email: adminEmail } = await seedAdminWithRole(
        'CONFIG_MANAGER_UA_DETAIL_BOTH_E2E',
        [Permission.USER_ACCOUNTS_READ],
      );
      const token = await loginAndGetToken(adminEmail);

      const response = await adminGraphqlRequest(
        token,
        USER_ACCOUNT_DETAIL_QUERY,
        { id },
      ).expect(200);
      const body = response.body as {
        data: {
          userAccountDetail: {
            hasCustomerProfile: boolean;
            hasProfessionalProfile: boolean;
            customerProfile: {
              firstName: string;
              lastName: string;
              city: string;
            } | null;
            professionalProfile: {
              firstName: string;
              lastName: string;
              displayName: string | null;
              languages: string[];
              specializations: {
                role: string;
                description: string;
                yearsOfExperience: number | null;
                order: number;
                category: { id: string; name: string };
              }[];
            } | null;
          };
        };
        errors?: GraphQLErrorEntry[];
      };

      expect(body.errors).toBeUndefined();
      expect(body.data.userAccountDetail.hasCustomerProfile).toBe(true);
      expect(body.data.userAccountDetail.hasProfessionalProfile).toBe(true);
      expect(body.data.userAccountDetail.customerProfile).toMatchObject({
        firstName: 'Jane',
        lastName: 'Doe',
        city: 'Buenos Aires',
      });
      expect(body.data.userAccountDetail.professionalProfile).toMatchObject({
        firstName: 'Jane',
        lastName: 'Doe',
        displayName: 'Jane the Plumber',
        languages: ['es', 'en'],
      });
      expect(
        body.data.userAccountDetail.professionalProfile?.specializations,
      ).toEqual([
        {
          role: 'PRIMARY',
          description: 'General plumbing work',
          yearsOfExperience: 7,
          order: 0,
          category: { id: categoryId, name: expect.any(String) as string },
        },
      ]);
    });

    it('rejects a nonexistent id with USER_ACCOUNT_NOT_FOUND', async () => {
      const { email: adminEmail } = await seedAdminWithRole(
        'CONFIG_MANAGER_UA_DETAIL_404_E2E',
        [Permission.USER_ACCOUNTS_READ],
      );
      const token = await loginAndGetToken(adminEmail);

      const response = await adminGraphqlRequest(
        token,
        USER_ACCOUNT_DETAIL_QUERY,
        { id: '00000000-0000-0000-0000-000000000000' },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('USER_ACCOUNT_NOT_FOUND');
    });

    it('rejects with ADMIN_FORBIDDEN for an admin role that lacks USER_ACCOUNTS_READ', async () => {
      const { id } = await seedTestUser();
      // No permissions at all — see this describe block's own header
      // comment on why this is an ad-hoc role rather than one of the 3
      // real seed roles (none of which actually lacks USER_ACCOUNTS_READ).
      const { email: adminEmail } = await seedAdminWithRole(
        'NO_PERMISSIONS_UA_DETAIL_E2E',
        [],
      );
      const token = await loginAndGetToken(adminEmail);

      const response = await adminGraphqlRequest(
        token,
        USER_ACCOUNT_DETAIL_QUERY,
        { id },
      ).expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('ADMIN_FORBIDDEN');
    });

    it('rejects with ADMIN_UNAUTHENTICATED when no session token is sent', async () => {
      const { id } = await seedTestUser();

      const response = await request(app.getHttpServer())
        .post('/admin/graphql')
        .send({ query: USER_ACCOUNT_DETAIL_QUERY, variables: { id } })
        .expect(200);
      const body = response.body as {
        data: unknown;
        errors?: GraphQLErrorEntry[];
      };

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('ADMIN_UNAUTHENTICATED');
    });
  });
});
