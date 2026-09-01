import { INestApplication } from '@nestjs/common';
import { AdminUserStatus, Permission } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
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

const EMAIL_TEMPLATES_QUERY = `
  query EmailTemplates {
    emailTemplates { id key subject htmlBody textBody updatedBy updatedAt }
  }
`;

const UPDATE_EMAIL_TEMPLATE_MUTATION = `
  mutation UpdateEmailTemplate($key: String!, $input: UpdateEmailTemplateInput!) {
    updateEmailTemplate(key: $key, input: $input) {
      id key subject htmlBody textBody updatedBy
    }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

const PASSWORD = 'super-secret-email-templates-1';
const TEMPLATE_KEY = 'verification_code';

/** Same fixed-length-suffix precedent every other e2e suite's own
 * `uniqueEmail` helper already uses (see `admin-rbac-management.e2e-spec.ts`). */
function uniqueEmail(prefix: string): string {
  const randomSuffix = Math.random()
    .toString(36)
    .slice(2)
    .padEnd(8, '0')
    .slice(0, 8);
  return `${prefix}-${Date.now()}-${randomSuffix}@example.com`;
}

/**
 * e2e coverage for the editable transactional-email templates admin surface
 * (`emailTemplates`/`updateEmailTemplate`) — permission gating
 * (`EMAIL_TEMPLATES_READ`/`EMAIL_TEMPLATES_WRITE`) and a real, persisted
 * update. `EmailTemplate` is a FIXED, seeded 3-row table (no
 * create/delete), shared with every other e2e suite that exercises
 * `register`/`resendVerificationCode`/`requestPasswordReset` — this suite
 * mutates the real `verification_code` row and MUST restore its original
 * content in `afterAll`, mirroring `withOnlyTheseAdminsHoldingManage`'s own
 * "reversible, minimal-blast-radius" precedent in
 * `admin-rbac-management.e2e-spec.ts`, rather than leaving the shared seed
 * data permanently altered for every suite that runs after this one.
 */
describe('GraphQL /admin/graphql — Email Templates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdRoleIds: string[] = [];
  let originalRow: {
    subject: string;
    htmlBody: string;
    textBody: string;
  } | null = null;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    await enableTestEmailDelivery(prisma);

    const existing = await prisma.emailTemplate.findUnique({
      where: { key: TEMPLATE_KEY },
    });
    if (existing) {
      originalRow = {
        subject: existing.subject,
        htmlBody: existing.htmlBody,
        textBody: existing.textBody,
      };
    }
  });

  afterAll(async () => {
    if (originalRow) {
      await prisma.emailTemplate.update({
        where: { key: TEMPLATE_KEY },
        data: originalRow,
      });
    }
    await cleanAdminUsersData(prisma);
    await prisma.adminRole.deleteMany({
      where: { id: { in: createdRoleIds } },
    });
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
    token: string | null,
    query: string,
    variables?: unknown,
  ) {
    const req = request(app.getHttpServer())
      .post('/admin/graphql')
      .send({ query, variables });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  it('a SUPPORT_VIEWER-permission session (read-only) gets ADMIN_FORBIDDEN on updateEmailTemplate', async () => {
    const { email } = await seedAdminWithRole(
      'EMAIL_TEMPLATES_SUPPORT_VIEWER',
      [Permission.EMAIL_TEMPLATES_READ],
    );
    const token = await loginAndGetToken(email);

    // Read access still works — EMAIL_TEMPLATES_READ is granted.
    const readResponse = await adminGraphqlRequest(
      token,
      EMAIL_TEMPLATES_QUERY,
    ).expect(200);
    const readBody = readResponse.body as {
      data?: { emailTemplates: { key: string }[] };
      errors?: GraphQLErrorEntry[];
    };
    expect(readBody.errors).toBeUndefined();
    expect(readBody.data?.emailTemplates.map((t) => t.key).sort()).toEqual([
      'admin_invite',
      'password_reset_code',
      'verification_code',
    ]);

    // Write access is rejected — EMAIL_TEMPLATES_WRITE is NOT granted.
    const writeResponse = await adminGraphqlRequest(
      token,
      UPDATE_EMAIL_TEMPLATE_MUTATION,
      {
        key: TEMPLATE_KEY,
        input: {
          subject: 'Should not be applied',
          htmlBody: '<p>irrelevant</p>',
          textBody: 'irrelevant',
        },
      },
    ).expect(200);
    const writeBody = writeResponse.body as { errors?: GraphQLErrorEntry[] };
    expect(writeBody.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
  });

  it('a CONFIG_MANAGER-shaped session can update a template, and the change persists on re-query', async () => {
    const { email } = await seedAdminWithRole(
      'EMAIL_TEMPLATES_CONFIG_MANAGER',
      [Permission.EMAIL_TEMPLATES_READ, Permission.EMAIL_TEMPLATES_WRITE],
    );
    const token = await loginAndGetToken(email);

    const newSubject = `E2E updated subject ${Date.now()}`;
    const newHtmlBody = '<p>{{greeting}} E2E {{code}}</p>';
    const newTextBody = '{{greeting}} E2E {{code}}';

    const updateResponse = await adminGraphqlRequest(
      token,
      UPDATE_EMAIL_TEMPLATE_MUTATION,
      {
        key: TEMPLATE_KEY,
        input: {
          subject: newSubject,
          htmlBody: newHtmlBody,
          textBody: newTextBody,
        },
      },
    ).expect(200);
    const updateBody = updateResponse.body as {
      data?: {
        updateEmailTemplate: { subject: string; updatedBy: string | null };
      };
      errors?: GraphQLErrorEntry[];
    };
    expect(updateBody.errors).toBeUndefined();
    expect(updateBody.data?.updateEmailTemplate.subject).toBe(newSubject);
    expect(updateBody.data?.updateEmailTemplate.updatedBy).toBe(
      `E2E EMAIL_TEMPLATES_CONFIG_MANAGER`,
    );

    const reQueryResponse = await adminGraphqlRequest(
      token,
      EMAIL_TEMPLATES_QUERY,
    ).expect(200);
    const reQueryBody = reQueryResponse.body as {
      data?: {
        emailTemplates: { key: string; subject: string; htmlBody: string }[];
      };
    };
    const persisted = reQueryBody.data?.emailTemplates.find(
      (t) => t.key === TEMPLATE_KEY,
    );
    expect(persisted?.subject).toBe(newSubject);
    expect(persisted?.htmlBody).toBe(newHtmlBody);

    // Also verifiable via a direct AdminAuditLog write in the same
    // transaction (see UpdateEmailTemplateService) — asserted at the DB
    // level rather than a query, since no `auditLog` viewer query exists.
    const auditRow = await prisma.adminAuditLog.findFirst({
      where: { action: 'EMAIL_TEMPLATE_UPDATED', targetKey: TEMPLATE_KEY },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditRow).not.toBeNull();
  });
});
