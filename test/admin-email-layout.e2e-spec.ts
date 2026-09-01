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

const EMAIL_LAYOUT_QUERY = `
  query EmailLayout {
    emailLayout { id headerHtml footerHtml headerText footerText logoUrl updatedBy updatedAt }
  }
`;

const UPDATE_EMAIL_LAYOUT_MUTATION = `
  mutation UpdateEmailLayout($input: UpdateEmailLayoutInput!) {
    updateEmailLayout(input: $input) {
      id headerHtml footerHtml headerText footerText logoUrl updatedBy
    }
  }
`;

const REQUEST_EMAIL_LOGO_UPLOAD_URL_MUTATION = `
  mutation RequestEmailLogoUploadUrl($input: RequestEmailLogoUploadUrlInput!) {
    requestEmailLogoUploadUrl(input: $input) { uploadUrl publicUrl expiresAt }
  }
`;

interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

const PASSWORD = 'super-secret-email-layout-1';
const EMAIL_LAYOUT_SINGLETON_ID = 'singleton';

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
 * e2e coverage for the shared email header/footer admin surface
 * (`emailLayout`/`updateEmailLayout`) — mirrors
 * `admin-email-templates.e2e-spec.ts` exactly: permission gating (reuses
 * the SAME `EMAIL_TEMPLATES_READ`/`EMAIL_TEMPLATES_WRITE` permissions — see
 * `EmailLayout`'s own header comment in `prisma/schema.prisma` for why) and
 * a real, persisted update. `EmailLayout` is a TRUE SINGLETON (`id`
 * always `'singleton'`), shared with every other e2e suite that exercises
 * `register`/`resendVerificationCode`/`requestPasswordReset`/
 * `sendTestEmailTemplate` — this suite mutates the real singleton row and
 * MUST restore its original content in `afterAll`, same
 * "reversible, minimal-blast-radius" precedent
 * `admin-email-templates.e2e-spec.ts` already establishes for
 * `EmailTemplate`.
 */
describe('GraphQL /admin/graphql — Email Layout (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const createdRoleIds: string[] = [];
  let originalRow: {
    headerHtml: string;
    footerHtml: string;
    headerText: string;
    footerText: string;
    logoUrl: string | null;
  } | null = null;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    const existing = await prisma.emailLayout.findUnique({
      where: { id: EMAIL_LAYOUT_SINGLETON_ID },
    });
    if (existing) {
      originalRow = {
        headerHtml: existing.headerHtml,
        footerHtml: existing.footerHtml,
        headerText: existing.headerText,
        footerText: existing.footerText,
        logoUrl: existing.logoUrl,
      };
    }
  });

  afterAll(async () => {
    if (originalRow) {
      await prisma.emailLayout.update({
        where: { id: EMAIL_LAYOUT_SINGLETON_ID },
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

  it('a SUPPORT_VIEWER-permission session (read-only) gets ADMIN_FORBIDDEN on updateEmailLayout', async () => {
    const { email } = await seedAdminWithRole('EMAIL_LAYOUT_SUPPORT_VIEWER', [
      Permission.EMAIL_TEMPLATES_READ,
    ]);
    const token = await loginAndGetToken(email);

    // Read access still works — EMAIL_TEMPLATES_READ is granted.
    const readResponse = await adminGraphqlRequest(
      token,
      EMAIL_LAYOUT_QUERY,
    ).expect(200);
    const readBody = readResponse.body as {
      data?: { emailLayout: { id: string } };
      errors?: GraphQLErrorEntry[];
    };
    expect(readBody.errors).toBeUndefined();
    expect(readBody.data?.emailLayout.id).toBe(EMAIL_LAYOUT_SINGLETON_ID);

    // Write access is rejected — EMAIL_TEMPLATES_WRITE is NOT granted.
    const writeResponse = await adminGraphqlRequest(
      token,
      UPDATE_EMAIL_LAYOUT_MUTATION,
      {
        input: {
          headerHtml: '<header>Should not be applied</header>',
          footerHtml: '<footer>irrelevant</footer>',
          headerText: '',
          footerText: 'irrelevant',
        },
      },
    ).expect(200);
    const writeBody = writeResponse.body as { errors?: GraphQLErrorEntry[] };
    expect(writeBody.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
  });

  it('a CONFIG_MANAGER-shaped session can update the layout, and the change persists on re-query', async () => {
    const { email } = await seedAdminWithRole('EMAIL_LAYOUT_CONFIG_MANAGER', [
      Permission.EMAIL_TEMPLATES_READ,
      Permission.EMAIL_TEMPLATES_WRITE,
    ]);
    const token = await loginAndGetToken(email);

    const newHeaderHtml = `<header>E2E header ${Date.now()}</header>`;
    const newFooterHtml = '<footer>{{greeting}} E2E footer</footer>';
    const newHeaderText = '';
    const newFooterText = '\n\nE2E footer text';
    const newLogoUrl = `http://localhost:3000/uploads/e2e-${Date.now()}.png`;

    const updateResponse = await adminGraphqlRequest(
      token,
      UPDATE_EMAIL_LAYOUT_MUTATION,
      {
        input: {
          headerHtml: newHeaderHtml,
          footerHtml: newFooterHtml,
          headerText: newHeaderText,
          footerText: newFooterText,
          logoUrl: newLogoUrl,
        },
      },
    ).expect(200);
    const updateBody = updateResponse.body as {
      data?: {
        updateEmailLayout: {
          headerHtml: string;
          logoUrl: string | null;
          updatedBy: string | null;
        };
      };
      errors?: GraphQLErrorEntry[];
    };
    expect(updateBody.errors).toBeUndefined();
    expect(updateBody.data?.updateEmailLayout.headerHtml).toBe(newHeaderHtml);
    expect(updateBody.data?.updateEmailLayout.logoUrl).toBe(newLogoUrl);
    expect(updateBody.data?.updateEmailLayout.updatedBy).toBe(
      `E2E EMAIL_LAYOUT_CONFIG_MANAGER`,
    );

    const reQueryResponse = await adminGraphqlRequest(
      token,
      EMAIL_LAYOUT_QUERY,
    ).expect(200);
    const reQueryBody = reQueryResponse.body as {
      data?: {
        emailLayout: {
          headerHtml: string;
          footerHtml: string;
          logoUrl: string | null;
        };
      };
    };
    expect(reQueryBody.data?.emailLayout.headerHtml).toBe(newHeaderHtml);
    expect(reQueryBody.data?.emailLayout.footerHtml).toBe(newFooterHtml);
    expect(reQueryBody.data?.emailLayout.logoUrl).toBe(newLogoUrl);

    // Also verifiable via a direct AdminAuditLog write in the same
    // transaction (see UpdateEmailLayoutService) — asserted at the DB level
    // rather than a query, since no `auditLog` viewer query exists.
    const auditRow = await prisma.adminAuditLog.findFirst({
      where: {
        action: 'EMAIL_LAYOUT_UPDATED',
        targetKey: EMAIL_LAYOUT_SINGLETON_ID,
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditRow).not.toBeNull();
  });

  // Uploadable-logo follow-up (2026-08-25) — `requestEmailLogoUploadUrl`
  // reuses the same EMAIL_TEMPLATES_READ/_WRITE gating and REST /uploads/:key
  // target as GOS-38's own attachment upload flow (`service-requests.e2e-spec.ts`),
  // just via a dedicated per-feature content-type allow-list (image only).
  describe('requestEmailLogoUploadUrl', () => {
    it('a SUPPORT_VIEWER-permission session (no EMAIL_TEMPLATES_WRITE) gets ADMIN_FORBIDDEN', async () => {
      const { email } = await seedAdminWithRole('EMAIL_LOGO_SUPPORT_VIEWER', [
        Permission.EMAIL_TEMPLATES_READ,
      ]);
      const token = await loginAndGetToken(email);

      const response = await adminGraphqlRequest(
        token,
        REQUEST_EMAIL_LOGO_UPLOAD_URL_MUTATION,
        { input: { fileName: 'logo.png', contentType: 'image/png' } },
      ).expect(200);
      const body = response.body as { errors?: GraphQLErrorEntry[] };
      expect(body.errors?.[0]?.extensions?.code).toBe('ADMIN_FORBIDDEN');
    });

    // `adminLogin` is deliberately strictly rate-limited (5/min — see
    // `AdminAuthResolver`'s own `@Throttle` comment), and this whole e2e
    // suite runs sequentially (`test/jest-e2e.json`'s `maxWorkers: 1`)
    // against one shared Redis-backed throttler window — so the 2 cases
    // below deliberately reuse ONE CONFIG_MANAGER login rather than each
    // calling `loginAndGetToken` separately, to avoid contributing more
    // than necessary to that shared budget across the whole suite run.
    it('rejects a disallowed content type, but issues a real uploadUrl/publicUrl for an allowed one that becomes servable after PUT', async () => {
      const { email } = await seedAdminWithRole('EMAIL_LOGO_CONFIG_MANAGER', [
        Permission.EMAIL_TEMPLATES_READ,
        Permission.EMAIL_TEMPLATES_WRITE,
      ]);
      const token = await loginAndGetToken(email);

      const rejectedResponse = await adminGraphqlRequest(
        token,
        REQUEST_EMAIL_LOGO_UPLOAD_URL_MUTATION,
        { input: { fileName: 'file.pdf', contentType: 'application/pdf' } },
      ).expect(200);
      const rejectedBody = rejectedResponse.body as {
        errors?: GraphQLErrorEntry[];
      };
      expect(rejectedBody.errors?.[0]?.extensions?.code).toBe(
        'UNSUPPORTED_EMAIL_LOGO_CONTENT_TYPE',
      );

      const response = await adminGraphqlRequest(
        token,
        REQUEST_EMAIL_LOGO_UPLOAD_URL_MUTATION,
        { input: { fileName: 'logo.png', contentType: 'image/png' } },
      ).expect(200);
      const body = response.body as {
        data?: {
          requestEmailLogoUploadUrl: {
            uploadUrl: string;
            publicUrl: string;
            expiresAt: string;
          };
        };
        errors?: GraphQLErrorEntry[];
      };
      expect(body.errors).toBeUndefined();
      const { uploadUrl, publicUrl } = body.data!.requestEmailLogoUploadUrl;
      expect(uploadUrl).toContain('/uploads/');
      expect(publicUrl).toContain('/uploads/');

      // Same path-extraction/round-trip pattern as
      // `service-requests.e2e-spec.ts`'s own attachment-upload test —
      // exercises the REAL `LocalDevStorageAdapter`/`UploadsController`,
      // not a mock.
      const fileBytes = Buffer.from('fake-png-bytes');
      const uploadPath = uploadUrl.replace(/^https?:\/\/[^/]+/, '');
      await request(app.getHttpServer())
        .put(uploadPath)
        .set('Content-Type', 'image/png')
        .send(fileBytes)
        .expect(200);

      const fetchPath = publicUrl.replace(/^https?:\/\/[^/]+/, '');
      const getResponse = await request(app.getHttpServer())
        .get(fetchPath)
        .expect(200);
      expect(Buffer.compare(getResponse.body as Buffer, fileBytes)).toBe(0);
    });
  });
});
